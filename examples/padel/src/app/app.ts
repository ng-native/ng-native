import { Component, computed, inject } from '@angular/core';
import {
  Pressable,
  SafeAreaProvider,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  View,
} from '@ng-native/components';
import { Watch } from '@ng-native/expo/watch';
import { MatchStore, TEAMS } from './match/match-store.ts';
import { pointLabel, scoreOf, type Score, type Team } from './match/match.ts';

@Component({
  imports: [Pressable, SafeAreaProvider, SafeAreaView, ScrollView, Switch, Text, View],
  selector: 'app-root',
  template: `
    <safe-area-provider>
      <safe-area-view class="screen">
        <scroll-view class="scroll" [contentContainerStyle]="{ padding: 20, gap: 16 }">
          <view class="top">
            <text class="title">Padel</text>
            <view class="pill" [class.live]="watch.reachable()">
              <view class="dot" [class.live]="watch.reachable()"></view>
              <text class="pill-text">{{ watchStatus() }}</text>
            </view>
          </view>

          <view class="board">
            @for (row of rows(); track row.name) {
              <view class="row" [class.won]="row.won">
                <text class="name">{{ row.name }}</text>
                @for (games of row.sets; track $index) {
                  <text class="set">{{ games }}</text>
                }
                <text class="games">{{ row.games }}</text>
                <view class="point-box">
                  <text class="point">{{ row.point }}</text>
                </view>
              </view>
            }
          </view>
          <text class="banner">{{ banner() }}</text>

          <view class="buttons">
            @for (name of teams; track $index) {
              <pressable
                accessibilityRole="button"
                class="score-button"
                [disabled]="over()"
                (press)="scorePoint($index)"
              >
                <text class="score-label">Point {{ name }}</text>
              </pressable>
            }
          </view>

          <view class="tools">
            <pressable
              accessibilityRole="button"
              class="tool"
              [disabled]="match.rallies().length === 0"
              (press)="match.undo()"
            >
              <text class="tool-text">Undo</text>
            </pressable>
            <pressable accessibilityRole="button" class="tool" (press)="match.newMatch()">
              <text class="tool-text">New match</text>
            </pressable>
            <view class="golden">
              <text class="tool-text">Golden point</text>
              <switch
                accessibilityLabel="Golden point"
                [(checked)]="golden"
                [trackColor]="{ true: '#d7f23c' }"
              ></switch>
            </view>
          </view>

          <text class="heading">Last points</text>
          @for (entry of log(); track entry.id) {
            <view class="entry">
              <text class="entry-who">{{ entry.who }}</text>
              <text class="entry-from">{{ entry.from }}</text>
              <text class="entry-score">{{ entry.score }}</text>
            </view>
          } @empty {
            <text class="empty">Tap a point here or on the watch to start.</text>
          }
        </scroll-view>
      </safe-area-view>
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
    .screen {
      flex: 1;
      background-color: #0b2a66;
    }
    .scroll {
      flex: 1;
    }
    .body {
      gap: 16px;
      padding: 20px;
    }
    .top {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .title {
      color: #ffffff;
      font-size: 34px;
      font-weight: 800;
    }
    .pill {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      background-color: rgba(255, 255, 255, 0.12);
    }
    .pill.live {
      background-color: rgba(215, 242, 60, 0.18);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background-color: #8fa3c9;
    }
    .dot.live {
      background-color: #d7f23c;
    }
    .pill-text {
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
    }
    .board {
      border-radius: 16px;
      overflow: hidden;
      background-color: #ffffff;
    }
    .row {
      flex-direction: row;
      align-items: center;
      padding-left: 18px;
      height: 72px;
      border-bottom-width: 1px;
      border-bottom-color: #e3e8f2;
    }
    .row.won {
      background-color: #f4fbd0;
    }
    .name {
      flex: 1;
      color: #0b2a66;
      font-size: 24px;
      font-weight: 700;
    }
    .set {
      width: 34px;
      text-align: center;
      color: #8fa3c9;
      font-size: 22px;
      font-weight: 600;
    }
    .games {
      width: 40px;
      text-align: center;
      color: #0b2a66;
      font-size: 26px;
      font-weight: 800;
    }
    .point-box {
      width: 84px;
      height: 72px;
      align-items: center;
      justify-content: center;
      margin-left: 10px;
      background-color: #0b2a66;
    }
    .point {
      color: #d7f23c;
      font-size: 30px;
      font-weight: 800;
    }
    .banner {
      min-height: 20px;
      color: #d7f23c;
      font-size: 16px;
      font-weight: 700;
      text-align: center;
    }
    .buttons {
      flex-direction: row;
      gap: 12px;
    }
    .score-button {
      flex: 1;
      height: 96px;
      align-items: center;
      justify-content: center;
      border-radius: 20px;
      background-color: #d7f23c;
    }
    .score-button:disabled {
      opacity: 0.4;
    }
    .score-label {
      color: #0b2a66;
      font-size: 22px;
      font-weight: 800;
    }
    .tools {
      flex-direction: row;
      align-items: center;
      gap: 10px;
    }
    .tool {
      padding: 10px 14px;
      border-radius: 12px;
      background-color: rgba(255, 255, 255, 0.12);
    }
    .tool:disabled {
      opacity: 0.4;
    }
    .tool-text {
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
    }
    .golden {
      flex: 1;
      flex-direction: row;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .heading {
      margin-top: 8px;
      color: #8fa3c9;
      font-size: 15px;
      font-weight: 700;
    }
    .entry {
      flex-direction: row;
      align-items: center;
      gap: 10px;
      padding: 12px 0;
      border-bottom-width: 1px;
      border-bottom-color: rgba(255, 255, 255, 0.1);
    }
    .entry-who {
      flex: 1;
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
    }
    .entry-from {
      color: #8fa3c9;
      font-size: 14px;
    }
    .entry-score {
      width: 96px;
      text-align: right;
      color: #ffffff;
      font-size: 16px;
      font-weight: 700;
    }
    .empty {
      color: #8fa3c9;
      font-size: 15px;
    }
  `,
})
export class App {
  protected readonly watch = inject(Watch);
  protected readonly match = inject(MatchStore);
  protected readonly teams = TEAMS;
  protected readonly golden = this.match.goldenPoint;

  protected readonly over = computed(() => this.match.score().winner !== null);

  protected readonly rows = computed(() => {
    const score = this.match.score();
    return TEAMS.map((name, index) => {
      const team = index as Team;
      return {
        name,
        sets: score.sets.map((set) => set[team]),
        games: score.games[team],
        point: score.winner === null ? pointLabel(score, team) : '',
        won: score.winner === team,
      };
    });
  });

  protected readonly banner = computed(() => {
    const score = this.match.score();
    if (score.winner !== null) return `${TEAMS[score.winner]} win the match`;
    if (score.tiebreak) return 'Tiebreak';
    if (score.points[0] >= 3 && score.points[0] === score.points[1]) {
      return this.match.goldenPoint() ? 'Golden point' : 'Deuce';
    }
    return '';
  });

  protected readonly log = computed(() => {
    const rallies = this.match.rallies();
    const golden = this.match.goldenPoint();
    return rallies
      .map((rally, index) => {
        const after = scoreOf(
          rallies.slice(0, index + 1).map((each) => each.team),
          golden,
        );
        return {
          id: rally.id,
          who: `${TEAMS[rally.team]} won the point`,
          from: rally.source === 'watch' ? 'on the watch' : 'on the phone',
          score: describe(after),
        };
      })
      .slice(-8)
      .reverse();
  });

  protected readonly watchStatus = computed(() => {
    if (!this.watch.available || !this.watch.paired()) return 'No watch';
    if (!this.watch.installed()) return 'Watch app not installed';
    return this.watch.reachable() ? 'Watch open' : 'Watch asleep';
  });

  protected scorePoint(index: number): void {
    this.match.point(index as Team);
  }
}

function describe(score: Score): string {
  if (score.winner !== null) return 'Match';
  if (score.points[0] === 0 && score.points[1] === 0) {
    const set = score.sets.at(-1);
    const games = score.games[0] + score.games[1] === 0 && set ? set : score.games;
    return `Game ${games[0]}-${games[1]}`;
  }
  return `${pointLabel(score, 0)}-${pointLabel(score, 1)}`;
}
