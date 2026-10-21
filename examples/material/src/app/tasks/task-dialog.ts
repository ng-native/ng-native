import { Component, inject, signal } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type NewTask, type Priority, daysFromToday } from './task-list.ts';

/** A new task: Material's dialog, form fields and selects, bound with Signal Forms. */
@Component({
  selector: 'app-task-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
    }
  `,
  template: `
    <h2 mat-dialog-title>New task</h2>
    <mat-dialog-content>
      <mat-form-field hideRequiredMarker>
        <mat-label>Title</mat-label>
        <input matInput testID="task-title" [formField]="task.title" />
        <mat-error>A task needs a title</mat-error>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Notes</mat-label>
        <textarea matInput rows="2" testID="task-notes" [formField]="task.notes"></textarea>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Priority</mat-label>
        <mat-select testID="task-priority" [formField]="task.priority">
          <mat-option value="low">Low</mat-option>
          <mat-option value="normal">Normal</mat-option>
          <mat-option value="high">High</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Due</mat-label>
        <mat-select testID="task-due" [formField]="task.due">
          <mat-option value="">No date</mat-option>
          <mat-option value="0">Today</mat-option>
          <mat-option value="1">Tomorrow</mat-option>
          <mat-option value="7">In a week</mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" [disabled]="task().invalid()" (click)="save()">Add</button>
    </mat-dialog-actions>
  `,
})
export class TaskDialog {
  private readonly ref = inject<MatDialogRef<TaskDialog, NewTask>>(MatDialogRef);
  // Material's calendar is a table, which web-compat does not lay out as one yet: the due date is
  // a choice of days from today instead.
  private readonly model = signal({
    title: '',
    notes: '',
    priority: 'normal' as Priority,
    due: '',
  });
  protected readonly task = form(this.model, (path) => {
    required(path.title);
  });

  protected save(): void {
    const { title, notes, priority, due } = this.model();
    this.ref.close({ title: title.trim(), notes, priority, due: due ? daysFromToday(+due) : null });
  }
}
