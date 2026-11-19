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
#   /empty-location 302 with an empty Location and a body; /multiple-choices 300 to /text
#   /moved          301 to /echo; /found 302 to /echo
#   /set-cookie     sets flavour=lemon
#   /gzip           a gzip-encoded body
#   /ws             a WebSocket that echoes, picks the subprotocol "chat", refuses "refuse", picks
#                   "other" when offered "pick-other", and answers the texts "pings" (pings seen),
#                   "fragments" (a message in two frames), "close-me" (a close 4000 "bye"),
#                   "ping-me" (a ping "hb", then logs the pong), "ping-flood" (reads nothing until
#                   the client's sends stall, pings 200 times, waits 300 ms, then reads until the
#                   text "done" and logs the pongs and the last one's payload), "bad-utf8" (a text
#                   that is not UTF-8), "split-utf8" (an é split across two frames),
#                   "flood" (2000 one-byte texts at once) and "close-later" (reads nothing for
#                   300 ms, closes 4000 "bye", then reads until the client's close frame and logs
#                   it). Offered "mute", it drops the connection on a close frame; offered
#                   "silent", it reads on without answering one.
#   /ws-log         what the WebSockets have logged, as a JSON array
import base64
import fcntl
import gzip
import hashlib
import json
import socketserver
import struct
import sys
import termios
import threading
import time
from urllib.parse import parse_qs, urlsplit

LOG = []
LOG_LOCK = threading.Lock()


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
        elif path == '/empty-location':
            self.respond(302, [('Location', '')], b'stay', reason='Found')
        elif path == '/multiple-choices':
            self.respond(300, [('Location', '/text')], b'choices', reason='Multiple Choices')
        elif path == '/moved':
            self.respond(301, [('Location', '/echo')], reason='Moved Permanently')
        elif path == '/found':
            self.respond(302, [('Location', '/echo')], reason='Found')
        elif path == '/ws-log':
            with LOG_LOCK:
                self.respond(200, [('Content-Type', 'application/json')], json.dumps(LOG).encode())
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
        elif 'pick-other' in protocols:
            head += 'Sec-WebSocket-Protocol: other\r\n'
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
                elif text == 'flood':
                    self.request.sendall((bytes([0x81, 1]) + b"f") * 2000)
                elif text == 'ping-me':
                    self.send_frame(9, b'hb')
                    answer = self.read_frame()
                    with LOG_LOCK:
                        LOG.append(f'pong {answer[1].decode()}' if answer and answer[0] == 10 else 'no pong')
                elif text == 'ping-flood':
                    self.wait_until_client_stalls()
                    for i in range(200):
                        self.send_frame(9, str(i).encode())
                    time.sleep(0.3)
                    pongs, last = 0, None
                    while True:
                        frame = self.read_frame()
                        if frame is None or (frame[0] == 1 and frame[1] == b'done'):
                            break
                        if frame[0] == 10:
                            pongs, last = pongs + 1, frame[1].decode()
                    with LOG_LOCK:
                        LOG.append(f'pongs {pongs} last {last}')
                elif text == 'bad-utf8':
                    self.send_frame(1, b'\xff\xfe')
                elif text == 'split-utf8':
                    self.send_frame(1, b'\xc3', fin=False)
                    self.send_frame(0, b'\xa9')
                elif text == 'close-later':
                    time.sleep(0.3)
                    self.send_frame(8, struct.pack('!H', 4000) + b'bye')
                    got = 'no close'
                    while True:
                        frame = self.read_frame()
                        if frame is None:
                            break
                        if frame[0] == 8:
                            got = f"close {struct.unpack('!H', frame[1][:2])[0]}" if len(frame[1]) >= 2 else 'close'
                            break
                    with LOG_LOCK:
                        LOG.append(got)
                    return
                else:
                    self.send_frame(1, payload)
            elif opcode == 2:
                self.send_frame(2, payload)
            elif opcode == 9:
                pings += 1
                self.send_frame(10, payload)
            elif opcode == 8:
                if 'mute' in protocols:
                    return
                if 'silent' in protocols:
                    continue
                self.send_frame(8, payload)
                return

    # Returns once the client's sends are held up: this side reads nothing, and its receive queue is
    # full, holding the same byte count across several polls. The pings that follow then find the
    # client unable to send a pong at once.
    def wait_until_client_stalls(self):
        last, steady = -1, 0
        deadline = time.monotonic() + 10
        while steady < 5 and time.monotonic() < deadline:
            queued = struct.unpack('i', fcntl.ioctl(self.request.fileno(), termios.FIONREAD, b'\0' * 4))[0]
            steady = steady + 1 if queued == last and queued >= 65536 else 0
            last = queued
            time.sleep(0.02)

    # An (opcode, payload) pair, or None once the connection ends, mid-frame included.
    def read_frame(self):
        head = self.stream.read(2)
        if len(head) < 2:
            return None
        opcode, length = head[0] & 0x0F, head[1] & 0x7F
        try:
            if length == 126:
                length = struct.unpack('!H', self.stream.read(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', self.stream.read(8))[0]
        except struct.error:
            return None
        mask = self.stream.read(4) if head[1] & 0x80 else b'\0\0\0\0'
        data = self.stream.read(length)
        if len(mask) < 4 or len(data) < length:
            return None
        # Unmasked as one integer, which a 16 MB payload needs to take well under a second.
        key = (mask * (length // 4 + 1))[:length]
        return opcode, (int.from_bytes(data, 'big') ^ int.from_bytes(key, 'big')).to_bytes(length, 'big')

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
