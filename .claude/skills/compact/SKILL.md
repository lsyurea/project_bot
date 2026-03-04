---
name: compact
description: Compresses and summarises the current conversation context window into a concise structured summary. Use this skill when the context is getting long or when the user asks to compact compress summarise the context or reduce context. Keywords: compact compress context window summarise summarize reduce tokens context overflow.
---

# Compact Skill

## Purpose

Compress the current conversation context into a dense structured summary that preserves all critical information while significantly reducing token usage. This allows long-running sessions to continue without hitting context limits.

## When to Use

- User explicitly requests compact compress context summarise context or reduce context
- The conversation has grown very long and risks hitting context limits
- Restarting a task mid-way and wanting to re-orient quickly

## Instructions

When this skill is invoked produce a structured summary with these sections:

### COMPACT SUMMARY

**Session Goal** - One or two sentences describing the overarching objective.

**Current Status** - What has been completed and what is in progress. Be specific about file paths function names and state of work.

**Key Decisions Made** - Bullet list of important decisions architectural choices or trade-offs agreed upon.

**Files Modified or Created** - List every file created or edited with a one-line description of the change.

**Outstanding Tasks** - Ordered list of what still needs to be done to complete the session goal.

**Critical Context** - Important constraints errors encountered environment details or background that must be remembered.

## Rules

1. Be ruthlessly concise - omit conversational filler repeated information and superseded decisions.
2. Preserve exactness for file paths function names variable names error messages commands and configuration values.
3. If code snippets are critical to continuing the task include the minimal necessary portion.
4. Always end with Outstanding Tasks and Critical Context so the next turn can immediately resume work.
5. After producing the summary state: Context compacted. Ready to continue.