-- Migration 003: add category column to entries
-- Stores LLM-classified category (Task, Thought, Reminder, Idea, Question, Decision)
-- NULL means not yet classified; user_category allows manual override.

ALTER TABLE entries ADD COLUMN category TEXT;
ALTER TABLE entries ADD COLUMN user_category TEXT;
