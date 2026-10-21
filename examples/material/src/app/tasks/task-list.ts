import { Service, computed, signal } from '@angular/core';

export type Priority = 'low' | 'normal' | 'high';

export interface Task {
  id: number;
  title: string;
  notes: string;
  priority: Priority;
  due: Date | null;
  done: boolean;
}

export type NewTask = Omit<Task, 'id' | 'done'>;

export const daysFromToday = (offset: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
};

/** The tasks, kept in memory: a demo, so a restart brings the starting list back. */
@Service()
export class TaskList {
  private nextId = 5;
  private readonly all = signal<Task[]>([
    {
      id: 1,
      title: 'Book flights',
      notes: '',
      priority: 'high',
      due: daysFromToday(2),
      done: false,
    },
    {
      id: 2,
      title: 'Renew passport',
      notes: 'Photo booth first',
      priority: 'normal',
      due: daysFromToday(10),
      done: false,
    },
    { id: 3, title: 'Water the plants', notes: '', priority: 'low', due: null, done: true },
    {
      id: 4,
      title: 'Call the bank',
      notes: '',
      priority: 'normal',
      due: daysFromToday(0),
      done: false,
    },
  ]);

  readonly tasks = this.all.asReadonly();
  readonly open = computed(() => this.all().filter((task) => !task.done));
  readonly done = computed(() => this.all().filter((task) => task.done));

  add(task: NewTask): Task {
    const added = { ...task, id: this.nextId++, done: false };
    this.all.update((tasks) => [added, ...tasks]);
    return added;
  }

  toggle(id: number): void {
    this.all.update((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
  }

  /** Removes a task, and answers a function that puts it back where it was. */
  remove(id: number): () => void {
    const index = this.all().findIndex((task) => task.id === id);
    const removed = this.all()[index];
    if (!removed) return () => undefined;
    this.all.update((tasks) => tasks.filter((task) => task.id !== id));
    return () =>
      this.all.update((tasks) => [...tasks.slice(0, index), removed, ...tasks.slice(index)]);
  }

  clearDone(): void {
    this.all.update((tasks) => tasks.filter((task) => !task.done));
  }
}
