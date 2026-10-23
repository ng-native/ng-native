import { formatDate } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SafeAreaView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { TaskDialog } from './task-dialog.ts';
import { type Task, TaskList } from './task-list.ts';

/** The one screen: the tasks to do and done, with Material's toolbar, tabs and overlays. */
@Component({
  selector: 'app-tasks-page',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTabsModule,
    MatToolbarModule,
    NativeHeader,
    SafeAreaView,
  ],
  styleUrl: './tasks-page.css',
  template: `
    <!-- Material's toolbar is the header. -->
    <native-header hidden />
    <safe-area-view class="screen">
      <mat-toolbar>
        <span>Tasks</span>
        <span class="spacer"></span>
        <button matIconButton aria-label="More" [matMenuTriggerFor]="more">
          <mat-icon>more_vert</mat-icon>
        </button>
      </mat-toolbar>
      <mat-menu #more="matMenu">
        <button mat-menu-item [disabled]="!list.done().length" (click)="list.clearDone()">
          <mat-icon>delete_sweep</mat-icon>
          <span>Clear completed</span>
        </button>
      </mat-menu>

      <div class="progress">
        <p>{{ list.done().length }} of {{ list.tasks().length }} done</p>
        <mat-progress-bar mode="determinate" [value]="percentDone()" />
      </div>

      <mat-tab-group class="tabs" [(selectedIndex)]="tab">
        <mat-tab [label]="'To do (' + list.open().length + ')'" />
        <mat-tab label="Done" />
      </mat-tab-group>

      <div class="list">
        @for (task of shown(); track task.id) {
          <div class="row">
            <mat-checkbox class="check" [checked]="task.done" (change)="list.toggle(task.id)">
              <div class="text">
                <div class="title">{{ task.title }}</div>
                @if (task.priority === 'high' || task.notes || task.due) {
                  <div class="detail">
                    @if (task.priority === 'high') {
                      <mat-icon class="flag" aria-label="High priority">flag</mat-icon>
                    }
                    <span>{{ detail(task) }}</span>
                  </div>
                }
              </div>
            </mat-checkbox>
            <button matIconButton [attr.aria-label]="'Delete ' + task.title" (click)="delete(task)">
              <mat-icon>delete_outline</mat-icon>
            </button>
          </div>
          <mat-divider />
        } @empty {
          <p class="empty">{{ tab() === 0 ? 'Nothing left to do.' : 'Nothing done yet.' }}</p>
        }
      </div>

      <button matFab class="add" aria-label="New task" (click)="create()">
        <mat-icon>add</mat-icon>
      </button>
    </safe-area-view>
  `,
})
export class TasksPage {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly list = inject(TaskList);

  protected readonly tab = signal(0);
  protected readonly shown = computed(() =>
    this.tab() === 0 ? this.list.open() : this.list.done(),
  );
  protected readonly percentDone = computed(() => {
    const total = this.list.tasks().length;
    return total ? (this.list.done().length / total) * 100 : 0;
  });

  /** The line under a title: when it is due, and its notes. */
  protected detail(task: Task): string {
    const due = task.due ? formatDate(task.due, 'EEE d MMM', 'en-US') : '';
    return [due, task.notes].filter(Boolean).join(' · ');
  }

  protected create(): void {
    this.dialog
      .open(TaskDialog, { width: '90vw' })
      .afterClosed()
      .subscribe((task) => {
        if (!task) return;
        this.list.add(task);
        this.tab.set(0);
        this.snackBar.open('Task added', undefined, { duration: 2000 });
      });
  }

  protected delete(task: Task): void {
    const undo = this.list.remove(task.id);
    this.snackBar
      .open(`Deleted "${task.title}"`, 'Undo', { duration: 4000 })
      .onAction()
      .subscribe(undo);
  }
}
