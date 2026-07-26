---
description: How work is done in this repository.
alwaysApply: true
---

# Working principles

**Effort is not an argument against something useful.** Never drop a feature
because it looks like a lot of work, and never dress that decision up as
avoiding overengineering. The test is usefulness, not size: build what is
needed, delete what is speculative. If the cost genuinely changes the plan, say
the cost out loud and let it be decided, rather than quietly scoping it out or
filing it under future work.

**Silence is the worst possible answer.** Anything that can come back empty has
to say so. A tool that stays quiet cannot be told apart from a tool that never
loaded, and the difference is paid for in wasted minutes. This holds for the
work itself too: name what was skipped and why.

**Existing code is not a standard.** Do not carry conventions over from another
project because they are familiar — they may be years out of date. Take the
current defaults of the tool at hand and change only what has a stated reason.

**A claim without evidence does not count.** Measure it, read the source, check
the live version. Never recommend, diagnose or reject from memory. One timing
run or one look inside `node_modules` settles what would otherwise cost
paragraphs of argument — and is just as good at killing an idea early.

**The bar is done well, not it works.** Working is the floor. Naming, comments,
commit history, error messages and defaults are part of the product, not
decoration on top of it.
