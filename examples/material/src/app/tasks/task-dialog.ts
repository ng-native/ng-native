import { Component, inject, signal } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { NewTask, Priority } from './task-list.ts';

/** A new task: Material's dialog, form fields, a select and a date picker, bound with Signal Forms. */
@Component({
  selector: 'app-task-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [provideNativeDateAdapter()],
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
    }
  `,
  template: `
    <h2 mat-dialog-title>New task</h2>
    <mat-dialog-content>
      <mat-form-field>
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
        <input matInput testID="task-due" [matDatepicker]="picker" [formField]="task.due" />
        <mat-datepicker-toggle matIconSuffix testID="task-due-toggle" [for]="picker" />
        <mat-datepicker #picker touchUi />
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
  private readonly model = signal({
    title: '',
    notes: '',
    priority: 'normal' as Priority,
    due: null as Date | null,
  });
  protected readonly task = form(this.model, (path) => {
    required(path.title);
    // Spaces alone are no title: the one saved is trimmed.
    validate(path.title, ({ value }) => (value().trim() ? undefined : { kind: 'required' }));
  });

  protected save(): void {
    const { title, notes, priority, due } = this.model();
    this.ref.close({ title: title.trim(), notes, priority, due });
  }
}
