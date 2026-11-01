# DEVELOP: projects and tasks

The live workbench ([develop-workbench.md](develop-workbench.md)) is good inside one Pi session. This adds what lasts **between** sessions: a
project you registered and the tasks you wrote under it, kept in the store root, shown beside the conversation and the Git changes. It is
operator metadata. It is not evidence, it is not a plan an agent follows, and it authorises nothing.

Four things stay apart, in the code and on the page:

| | What it is | Who owns it |
| :-- | :-- | :-- |
| **Project** | A directory you registered, with a name (`endo.project.<id>`). | You, by `endo project add`. |
| **Task** | What you intend to get done: a title, optional description and acceptance criteria, and a status (`endo.task.<id>`). | You. |
| **Worktree** | A Git working tree the broker reads, read-only ([develop-project-review.md](develop-project-review.md)). | Git. |
| **Session** | A Pi session the attached process owns (the neutral surface, [develop-session-surface.md](develop-session-surface.md)). | The attached process. |

A project is not a session. A task is not a prompt. A worktree is not an agent. **An agent finishing is not a task done**: no run ending, final
answer, disconnect or STOP changes a task, and only your button or your `endo task status` command changes a status.

## The operator's journey

```sh
# Once per project: an explicit statement that this directory is this project. Nothing is opened or run.
endo project add --root ./recordings --name "Parser work" --path /path/to/project     # prints the project id

# Each working session: name the project. --project sets no directory; --cwd (or the process's own) does.
endo harness attach ./recordings --cwd /path/to/project --control --workbench --project endo.project.<id>
```

1. Open the workbench address, choose **Develop**, pair. The bar above the run strip names the **project** and whether its directory matches
   (`✓ matches`, or `⚠ other directory`, `⚠ path missing`, `⚠ other worktree`).
2. Press **T** or open the **Task** picker in the bar, choose **+ New task…** (or open the **Task** tab), write a title and, optionally, a
   description and acceptance criteria, and **Create task**. Creating a task selects it. It sends nothing.
3. Work in the same conversation. The bar keeps the current task and its status; **Conversation | Changes | Task** are three views of one
   session, with the run strip (and STOP) and the composer docked under all of them. Choosing a task never sends a prompt, changes the
   attached session or the worktree, grants anything, discards your unsent draft or changes a status.
4. Review the changes in **Changes**, as before.
5. In **Task**, record progress yourself: **Start work**, **Ready for review**, **Mark done** (with an optional note), **Mark blocked**,
   **Back to open**, **Reopen**. **Link the current session** records a reference from the task to the session this workbench is connected to.
6. Close the workbench. The tasks are in `<root>/develop/tasks.json`. `endo task list --project <id>` reads them with no workbench; the next
   workbench started with the same `--project` shows them, with the task you last chose selected.

Status moves are small and reversible: `open → in-progress | blocked`, `in-progress → review | blocked | open`, `blocked → open | in-progress`,
`review → done | in-progress | blocked`, `done → open` (an explicit reopening). `done` is reachable only from `review`.

## The project and its three facts

A project is **never inferred** from a remote URL, a branch name, an alias or a path you happened to be in. It exists only because you registered
it, and what the page shows is three separate facts:

- **Registered** (configured): the directory you named, as the system spells it with links resolved at that moment. `observedGitRoot` is what
  Git said the worktree root there was at registration (or none).
- **Launch**: whether the directory this workbench was launched in is **the same place**, a different one, or the registered one is gone.
  Equality is exact: launching from a *subdirectory* of the registered path is a different directory. Register the subdirectory if that is
  where you work.
- **Git, now**: what the broker's read-only Git inspection of the launch directory reports (the existing worktree bar), compared on the
  page with the root recorded at registration.

A mismatch or a missing directory makes the workspace **read-only**: the tasks are shown (they are yours), nothing is changed, and the page and
the terminal say why. A registered path grants no access to anything: it is compared and displayed, never opened, listed or run, and a task's text
is never used to pick a file, a tool or a command.

## Where it lives, and what is in it

`<root>/develop/tasks.json` (`endo.develop-tasks.v0`), beside the evidence and never inside it: it is not an event, is never appended to the event
log, and no existing store file is read, migrated or rewritten. Deleting `develop/` loses tasks and nothing else.

| Stored | Not stored here |
| :-- | :-- |
| Projects you registered (name, path, observed Git root) | Live transcripts, model-provided reasoning, prompts |
| Tasks: title, description, acceptance criteria, status, timestamps, revision | Pairing codes, grants, approval phrases |
| Your status changes: when, from, to, an optional short note (the newest 50) | Provider credentials |
| Which task you last chose | Tool arguments or results, diffs, file contents |
| Session references you asked for (below) | |

**Privacy.** Task text is plain text in an owner-only file (`0600`, in a `0700` directory). It is shown to a **paired** workbench page and to `endo
task` in your terminal, and to nothing else: `endo studio` (the read-only server) has no route for it, and a test puts a canary in a task and
fetches each Studio read route family (the snapshot, the session list and one recorded session, the Compare candidates, and the workbench probes). **Do not put secrets in a task**: Endophasia does not scan it. **Retention:** tasks stay until you remove `develop/`
(there is no delete command in this slice); text can be cleared by editing it, which replaces it in the file. Nothing is sent anywhere.

## Persistence rules

- One small file, rewritten whole, at most 4 MiB: 8 projects, 300 tasks; a title of 120 characters; 4 000 characters each for description and
  acceptance criteria; notes of 280. Text is closed: no control characters except newline and tab, no line separators, no bidirectional overrides.
- Every change is: take the writer lock (`develop/tasks.lock.<n>`: the highest number is the lock, created exclusively, naming its pid; a lock of a dead process is superseded by the next number, never removed from under a writer that has just taken it), **read the file again
  from disk**, validate, apply **one** change to that copy, validate the result, write a uniquely named temporary file (mode `0600`, created
  exclusively and never through a link), `fsync`, rename over the file, `fsync` the directory. A crash leaves the old file or the new one.
  Temporary files a crash left are removed by the next writer. A change that finds nothing to do (choosing what is already chosen, linking a session
  already linked in this launch) writes nothing.
- Two processes write it (the workbench and the CLI). A **per-task revision** means an edit made against an old view is refused
  (`stale-revision`), never merged. The page sends only the fields you changed; after a refusal it reads again, a field you did not touch takes the
  new words, and a field **both** you and someone else changed keeps your words, shows the other version beside them, and is replaced only when you
  save again.
- A file that is malformed, of an unknown version, over the limit, invalid, or reached through a link is **unreadable**: it is reported with a closed
  reason, no write is ever made over it, and it is left byte for byte as found. The directory and the file are checked with `lstat` and opened with
  `O_NOFOLLOW`; a symbolic link is refused, not followed.

## Authority

The routes are inside the existing workbench broker (`adapters/pi/workbench-tasks.ts`), so they pass every guard the broker's routes pass: Host,
Origin and Fetch Metadata, an exact same-origin `Origin`, `application/json` and the 40 KiB body bound for a `POST`, and the **grant** from the pairing
code. There is no new route family and no new capability:

| Route (under `api/v0/workbench/`) | |
| :-- | :-- |
| `GET workspace` | the registered project, its tasks, references; or one constant when no project was named |
| `POST workspace/tasks/create`, `update`, `status`, `select`, `link-session`, `unlink-session` | closed bodies, a task id and the revision it saw |

None of them sends a prompt, steers, queues or stops, starts, resumes or selects a session, runs Git or a shell, opens or writes any file but
`develop/tasks.json`, reads the transcript, or approves anything. The terminal approval, the pairing grant, capability admission and STOP are unchanged,
and metadata is **not** a second approval mechanism. Without a grant (an unpaired browser, a page after its session ended) nothing is read or changed.
`endo studio` has no workbench: the routes are not found there and a `POST` is refused.

When the workbench's session ends the broker revokes the grant (as it always has, so no private text outlives it). The page then keeps the tasks it
last read, marked *last read*, with every change disabled and the sentence "a disconnected agent has not necessarily finished its work". There is no
second, longer-lived grant for metadata: `endo task` is the way to read and edit without a live workbench.

## Session references

A task may carry **explicit** references to a session. A reference is made only by your **Link the current session** button, and the broker
builds it from its own state, never from anything the page sends:

```json
{ "linkId": "…", "source": "pi-live", "sessionId": "endo.session.pi.…", "attachment": "pi.default",
  "launchId": "…", "linkedAtMs": 0, "linkedBy": "operator", "via": "workbench" }
```

It records one claim: *at that time you asked this workbench, in that launch, to link this task to the session it served.* The page is given the
cockpit's alias (a label, never a key) and a **relation**:

- `current`: made in **this** launch, to the session connected now.
- `historical`: made in another launch (or the session is not connected). Even if a later launch serves a Pi session with the very same id, it is
  historical: launch-scoped identity is not reused, and the page says "whether that session is still the one attached cannot be verified".

Nothing links a task to a session by an alias, a name, a time, a directory or proximity, a recorded Pi or DSH session is never associated
automatically, and a reference gives a task no control over a session: no resume, no selection, no prompt. The neutral surface
(`endo.develop-session-surface.v0`) is unchanged and has no task field.

## Limitations, and what is deferred

- One project per workbench launch, named with `--project`; no project launcher, no automatic start of Pi, no worktree creation or checkout.
- No task deletion, archive, search, tags, dependencies, priorities, due dates, or assignment; no agent selection, scheduling, retries or plans.
- The Git association is by exact launch directory; a subdirectory launch is read-only.
- `endo task` can list, add and change status; editing words and links is in the workbench page.
- A registered path or task text is not scanned for secrets.
- The store has no cross-machine sync. Moving a project to another path means registering it again.
- Locks: the lock is a series of numbered files and the highest number holds it (see the header of `storage/develop-tasks.ts`). A writer takes it by
  creating the next number (a hard link of a finished file, so only one contender can create it); a lock whose process is gone is simply
  superseded by the next number; nothing is removed or rewritten to take a lock from another writer, and the highest number is never deleted (a
  release marks it released), so a number is never reused. One `tasks.lock.<n>` file therefore remains at rest; it is harmless. What is left: a
  lock naming a pid the system has since reused makes writes answer `busy` until `develop/tasks.lock.<n>` is removed by hand. This is a stricter
  pattern than the attachment's writer lock, which this slice does not touch.
- Real-runtime evidence is one local smoke, not conformance: the installed **Pi 1.4.0** launched once from the registered directory with the workbench
  and `--project`; a page paired, created a task, linked the session (Pi's own session id fit the reference format; relation `current`) and moved its
  status. **No prompt was proposed, no model or provider was selected, no terminal approval was asked**, and the store was a throwaway directory deleted
  afterwards. Everything else is tested against the fake Pi and fake session fixtures.

## Design review (Opus, read-only)

An independent Opus advisor reviewed the design before it was built and the built interface from real screenshots. Dispositions:

| Finding | Disposition |
| :-- | :-- |
| Keep the grant revocation at session end; show last-read tasks marked, changes disabled; the CLI is the edit path | **Accepted** |
| The session reference is built from the broker's state; the body carries only a task id and revision; same Pi id after a restart stays historical | **Accepted** (tested) |
| A lock file and a per-task revision; re-read on every operation; unique temporary files | **Accepted** (multi-process test) |
| A retry after a stale edit would write back a stale field | **Fixed**: edits send only changed fields and rebase; both-changed fields are flagged |
| Remember the chosen task on the server, not in the browser | **Accepted** (the page keeps no storage) |
| Merging the cluster into the worktree bar avoids a new row | **Accepted, with a cost**: at 1440 px (three columns) the bar wraps to three lines; one at wide windows |
| Remove "Task details" (duplicates the tab); association as glyph and a word; absent state is "No project" | **Fixed** |
| Task view: title first; read time and Refresh at the foot; fewer standing sentences; forward move primary | **Fixed** |
| `T` only where nobody is typing and only in DEVELOP; no autofocus unless the operator asked for a new task | **Fixed** (browser tests) |
| `over()` in writable gave a false "mismatch" | **Fixed** (removed) |
| A no-op write for an unchanged selection or link | **Fixed** (nothing is written) |
| Real-runtime coverage | **Scoped**: one local Pi 1.4.0 smoke with no prompt (see Limitations); everything else fake Pi; no conformance claim |
| A delete or archive command; a longer-lived metadata grant; a task-to-session lookup by alias | **Declined** for this slice |

## Screenshots

Real browser renders of **synthetic** fixtures (fake Pi session, a synthetic Git repository, no private text, no model run):
[Instrument, no task yet](images/develop-tasks-instrument-empty-1440.png) ·
[Instrument, Task view](images/develop-tasks-instrument-task-1440.png) ·
[Instrument, picker at 1280 px](images/develop-tasks-instrument-picker-1280.png) ·
[Field, Task view](images/develop-tasks-field-task-1440.png) ·
[Field, Focus](images/develop-tasks-field-focus-1440.png) ·
[a launch in another directory: read-only](images/develop-tasks-instrument-mismatch-1440.png) ·
[the session disconnected: tasks as last read](images/develop-tasks-instrument-disconnected-1440.png) ·
[phone, 390 px](images/develop-tasks-instrument-task-390.png).
