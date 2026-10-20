# Operations platform

Features `operations.templates` and `operations.custom`; limit `operations.workspaces.max`; permissions `operations.view`, `operations.contribute` and `operations.manage`.

- **Workspace**: a place to track one kind of work (service requests, quality audits, production batches, support tickets, or your own). It belongs to a company, has a code, and numbers its items `PREFIX-0001`, never repeating or skipping a number even when many are raised at once.
- **Templates**: four built-in ones give ready stages and questions. Plans with `operations.templates` can start from them.
- **Custom setup** (`operations.custom`): start blank, or change the stages and questions. Stages are open work, finished or dropped; the first stage is where new items start and there must be one open and one finished stage. A stage that still holds items can't be removed. Questions can be text, number, date, a choice or yes/no, and can be required. Answers are checked on every save.
- **Items** have a title, details, priority, due date, an assignee, answers to the questions and a stage. The database refuses a stage that belongs to another workspace.
- **History**: every raise, change, move, assignment and comment is recorded with who did it. Entries are never changed or removed.
- **Who can do what**: `view` sees the workspace and its items; `contribute` also raises, edits, assigns, moves and comments; `manage` also creates workspaces and changes their setup. The person an item is assigned to can see it, edit its details, move it and comment, but not reassign it. Everyone has "My work", their open assigned items.
- **Plan limit**: archived workspaces don't count towards `operations.workspaces.max`. The Lite plan has none.
- Included in the organisation data export.
