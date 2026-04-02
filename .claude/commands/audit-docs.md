Audit all documentation in `docs/` for staleness, then report what needs updating.

## Steps

1. **Read every doc.** Read all `.md` files in `docs/` and the `CLAUDE.md` root file. Note each file's `status` and `verified` frontmatter fields.

2. **Check improvement-checklist.md items.** For each unchecked `- [ ]` item:
   - Identify what code/file/pattern it references (e.g., a prompt rule, a script, a DB table)
   - Grep or glob for that thing in the codebase
   - If it exists and appears implemented, flag the item as "likely done — verify and check off"
   - If partially done, note what remains

3. **Check file path references.** For every file path mentioned in any doc (e.g., `src/agents/writer/prompt.md`, `models/roles.ts`):
   - Verify the file exists
   - If the doc makes claims about what's in the file (e.g., "line 17 has X"), spot-check that claim
   - Flag broken paths or stale claims

4. **Check cross-references.** For every doc-to-doc reference (e.g., "see docs/methodology-integration-report.md"):
   - Verify the target exists
   - Flag broken links

5. **Check CLAUDE.md reference docs section.** Verify every doc in `docs/` is listed there. Flag any missing or extra entries.

6. **Check proposal docs.** For docs with `status: proposal`:
   - Are any of the proposed features now implemented?
   - Do they reference paths/tables that still don't exist?
   - Should the status change?

7. **Produce a report.** Output a table:
   ```
   | File | Status | Verified | Issues |
   |------|--------|----------|--------|
   ```
   
   Then for each file with issues, list:
   - What's stale and what the fix is
   - Which checklist items should be checked off
   - Which paths are broken

   End with a prioritized list of fixes (most impactful first).

## Rules

- Do NOT make any edits — this is a read-only audit. Report findings for the user to act on.
- Be specific: quote the stale text and what it should say instead.
- If a `verified` date is older than 30 days, flag it as "needs re-verification" even if nothing else looks wrong.
- Keep the report concise — one line per issue, not paragraphs.

$ARGUMENTS: Optional — pass "fix" to also apply the fixes instead of just reporting them.
