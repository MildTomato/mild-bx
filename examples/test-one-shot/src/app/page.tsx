'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase, type Todo, type TodoUpdate, type Priority } from '@/lib/supabase';

type Filter = 'all' | 'active' | 'completed';

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const fetchTodos = useCallback(async () => {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching todos:', error);
    } else {
      setTodos(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    const { error } = await supabase.from('todos').insert([
      {
        title: newTodo.trim(),
        priority: newPriority,
        due_date: newDueDate || null,
      },
    ]);

    if (error) {
      console.error('Error adding todo:', error);
    } else {
      setNewTodo('');
      setNewPriority('medium');
      setNewDueDate('');
      fetchTodos();
    }
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    const { error } = await supabase
      .from('todos')
      .update({ completed: !completed, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error updating todo:', error);
    } else {
      fetchTodos();
    }
  };

  const updateTodo = async (id: string, updates: TodoUpdate) => {
    const { error } = await supabase
      .from('todos')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error updating todo:', error);
    } else {
      fetchTodos();
    }
  };

  const deleteTodo = async (id: string) => {
    const { error } = await supabase.from('todos').delete().eq('id', id);

    if (error) {
      console.error('Error deleting todo:', error);
    } else {
      fetchTodos();
    }
  };

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.title);
  };

  const saveEdit = async (id: string) => {
    if (editText.trim()) {
      await updateTodo(id, { title: editText.trim() });
    }
    setEditingId(null);
    setEditText('');
  };

  const filteredTodos = todos.filter((todo) => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  const priorityColor = (priority: Priority) => {
    switch (priority) {
      case 'high':
        return 'text-red-400 bg-red-400/10 border-red-400/30';
      case 'medium':
        return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
      case 'low':
        return 'text-blue-400 bg-blue-400/10 border-blue-400/30';
    }
  };

  const isOverdue = (dueDate: string | null) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
  };

  const formatDate = (date: string | null) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">
          Todo App
        </h1>
        <p className="text-slate-400 text-center mb-8">
          {activeCount} active, {completedCount} completed
        </p>

        {/* Add Todo Form */}
        <form onSubmit={addTodo} className="mb-6 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="What needs to be done?"
              className="flex-1 px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 border border-slate-600 focus:outline-none focus:border-emerald-500 transition"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition font-medium"
            >
              Add
            </button>
          </div>
          <div className="flex gap-3">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              className="px-3 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 focus:outline-none focus:border-emerald-500"
            >
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </form>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(['all', 'active', 'completed'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium transition capitalize ${
                filter === f
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Todo List */}
        {loading ? (
          <p className="text-slate-400 text-center">Loading...</p>
        ) : filteredTodos.length === 0 ? (
          <p className="text-slate-400 text-center">
            {filter === 'all'
              ? 'No todos yet. Add one above!'
              : `No ${filter} todos.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredTodos.map((todo) => (
              <li
                key={todo.id}
                className={`flex items-center gap-3 p-4 bg-slate-700/50 rounded-lg border transition ${
                  todo.completed
                    ? 'border-slate-600/50 opacity-60'
                    : 'border-slate-600'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleTodo(todo.id, todo.completed)}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${
                    todo.completed
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'border-slate-400 hover:border-emerald-500'
                  }`}
                >
                  {todo.completed && (
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {editingId === todo.id ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => saveEdit(todo.id)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(todo.id)}
                      className="w-full px-2 py-1 rounded bg-slate-600 text-white border border-slate-500 focus:outline-none focus:border-emerald-500"
                      autoFocus
                    />
                  ) : (
                    <span
                      onDoubleClick={() => startEdit(todo)}
                      className={`block truncate cursor-pointer ${
                        todo.completed
                          ? 'text-slate-400 line-through'
                          : 'text-white'
                      }`}
                    >
                      {todo.title}
                    </span>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${priorityColor(
                        todo.priority
                      )}`}
                    >
                      {todo.priority}
                    </span>
                    {todo.due_date && (
                      <span
                        className={`text-xs ${
                          isOverdue(todo.due_date) && !todo.completed
                            ? 'text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {isOverdue(todo.due_date) && !todo.completed
                          ? '⚠ '
                          : ''}
                        {formatDate(todo.due_date)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Priority Dropdown */}
                <select
                  value={todo.priority}
                  onChange={(e) =>
                    updateTodo(todo.id, { priority: e.target.value as Priority })
                  }
                  className="px-2 py-1 text-sm rounded bg-slate-600 text-slate-300 border border-slate-500 focus:outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Med</option>
                  <option value="high">High</option>
                </select>

                {/* Delete */}
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="text-slate-400 hover:text-red-400 transition flex-shrink-0"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Clear Completed */}
        {completedCount > 0 && (
          <div className="mt-6 text-center">
            <button
              onClick={async () => {
                await supabase.from('todos').delete().eq('completed', true);
                fetchTodos();
              }}
              className="text-slate-400 hover:text-red-400 text-sm transition"
            >
              Clear {completedCount} completed
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
