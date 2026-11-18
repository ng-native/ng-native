#!/usr/bin/env python3
# A local HTTP/1.1 and WebSocket server for the libcurl client's tests (network.test.cpp), on the
# standard library only. It prints the port it listens on, then serves until its stdin closes.
#
#   /text           200 with a body and a repeated header
#   /echo           the request as JSON: method, headers, body (its length past 1000 bytes)
#   /slow?ms=N      /text after N ms of silence
#   /drip?n=N&ms=M  N bytes, one every M ms
#   /stall          headers and part of the body, then silence
#   /redirect       302 to /text; /see-other 303 and /temporary 307 to /echo; /loop 302 to itself
#   /set-cookie     sets flavour=lemon
#   /gzip           a gzip-encoded body
#   /ws             a WebSocket that echoes, picks the subprotocol "chat", refuses "refuse", and
#                   answers the texts "pings" (pings seen), "fragments" (a message in two frames)
#                   and "close-me" (a close 4000 "bye")
import base64
import gzip
import hashlib
import json
import socketserver
import struct
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.stream = self.request.makefile('rb')
        while True:
            line = self.stream.readline()
            if not line:
                return
            method, target, _ = line.decode('latin-1').split(' ', 2)
            headers = []
            while True:
                header = self.stream.readline().decode('latin-1')
                if header in ('\r\n', '\n', ''):
                    break
                name, value = header.split(':', 1)
                headers.append((name.strip(), value.strip()))
            lower = {name.lower(): value for name, value in headers}
            body = self.stream.read(int(lower['content-length'])) if 'content-length' in lower else b''
            url = urlsplit(target)
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            if url.path == '/ws':
                self.websocket(lower)
                return
            if not self.route(method, url.path, query, headers, body):
                return

    def respond(self, status, headers=(), body=b'', reason='OK'):
        head = f'HTTP/1.1 {status} {reason}\r\n'
        for name, value in headers:
            head += f'{name}: {value}\r\n'
        head += f'Content-Length: {len(body)}\r\n\r\n'
        self.request.sendall(head.encode('latin-1') + body)

    # False once the connection is done with.
    def route(self, method, path, query, headers, body):
        if path == '/text':
            self.respond(200, [('Content-Type', 'text/plain'), ('X-Test', 'a'), ('X-Test', 'b')], b'hello')
        elif path == '/echo':
            out = {'method': method, 'headers': [[k, v] for k, v in headers], 'bodyLength': len(body)}
            if len(body) <= 1000:
                out['body'] = body.decode('latin-1')
            self.respond(200, [('Content-Type', 'application/json')], json.dumps(out).encode())
        elif path == '/slow':
            time.sleep(int(query.get('ms', '0')) / 1000)
            self.respond(200, [('Content-Type', 'text/plain')], b'hello')
        elif path == '/drip':
            n, ms = int(query['n']), int(query['ms'])
            self.request.sendall(f'HTTP/1.1 200 OK\r\nContent-Length: {n}\r\n\r\n'.encode())
            for _ in range(n):
                time.sleep(ms / 1000)
                self.request.sendall(b'x')
        elif path == '/stall':
            self.request.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc')
            time.sleep(30)
            return False
        elif path == '/redirect':
            self.respond(302, [('Location', '/text')], b'moved', reason='Found')
        elif path == '/see-other':
            self.respond(303, [('Location', '/echo')], reason='See Other')
        elif path == '/temporary':
            self.respond(307, [('Location', '/echo')], reason='Temporary Redirect')
        elif path == '/loop':
            self.respond(302, [('Location', '/loop')], reason='Found')
        elif path == '/set-cookie':
            self.respond(200, [('Set-Cookie', 'flavour=lemon; Path=/')])
        elif path == '/gzip':
            self.respond(200, [('Content-Encoding', 'gzip')], gzip.compress(b'zipped'))
        else:
            self.respond(404, reason='Not Found')
        return True

    def websocket(self, headers):
        protocols = [p.strip() for p in headers.get('sec-websocket-protocol', '').split(',') if p.strip()]
        if 'refuse' in protocols:
            self.respond(403, reason='Forbidden')
            return
        key = headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC11B85'
        accept = base64.b64encode(hashlib.sha1(key.encode()).digest()).decode()
        head = ('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                f'Sec-WebSocket-Accept: {accept}\r\n')
        if 'chat' in protocols:
            head += 'Sec-WebSocket-Protocol: chat\r\n'
        self.request.sendall((head + '\r\n').encode())
        pings = 0
        while True:
            frame = self.read_frame()
            if frame is None:
                return
            opcode, payload = frame
            if opcode == 1:
                text = payload.decode()
                if text == 'pings':
                    self.send_frame(1, str(pings).encode())
                elif text == 'fragments':
                    self.send_frame(1, b'y' * 100000, fin=False)
                    self.send_frame(0, b'z' * 100000)
                elif text == 'close-me':
                    self.send_frame(8, struct.pack('!H', 4000) + b'bye')
                    self.read_frame()
                    return
                else:
                    self.send_frame(1, payload)
            elif opcode == 2:
                self.send_frame(2, payload)
            elif opcode == 9:
                pings += 1
                self.send_frame(10, payload)
            elif opcode == 8:
                self.send_frame(8, payload)
                return

    def read_frame(self):
        head = self.stream.read(2)
        if len(head) < 2:
            return None
        opcode, length = head[0] & 0x0F, head[1] & 0x7F
        if length == 126:
            length = struct.unpack('!H', self.stream.read(2))[0]
        elif length == 127:
            length = struct.unpack('!Q', self.stream.read(8))[0]
        mask = self.stream.read(4) if head[1] & 0x80 else b'\0\0\0\0'
        data = self.stream.read(length)
        return opcode, bytes(b ^ mask[i % 4] for i, b in enumerate(data))

    def send_frame(self, opcode, payload, fin=True):
        head = bytes([(0x80 if fin else 0) | opcode])
        if len(payload) < 126:
            head += bytes([len(payload)])
        elif len(payload) < 65536:
            head += bytes([126]) + struct.pack('!H', len(payload))
        else:
            head += bytes([127]) + struct.pack('!Q', len(payload))
        self.request.sendall(head + payload)


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


server = Server(('127.0.0.1', 0), Handler)
print(server.server_address[1], flush=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sys.stdin.read()
