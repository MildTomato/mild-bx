-- Priority enum
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high');

-- Todos table
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  priority priority_level NOT NULL DEFAULT 'medium',
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for demo
CREATE POLICY "Allow anonymous read" ON todos FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert" ON todos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update" ON todos FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete" ON todos FOR DELETE USING (true);
