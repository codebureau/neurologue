-- Migration 004: Add user_name column to themes
-- user_name stores an explicit name set by the user.
-- When set, it takes precedence over the LLM-generated name.
-- The clustering pipeline respects this and will not overwrite it.

ALTER TABLE themes ADD COLUMN user_name TEXT;
