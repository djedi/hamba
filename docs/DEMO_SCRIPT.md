# Hamba Demo Recording Script

This document provides a step-by-step script for recording a demo video/GIF showcasing Hamba's key features.

## Recommended Tools

### For GIF Recording (macOS)
- **[Kap](https://getkap.co/)** - Free, open source screen recorder optimized for GIF export
- **[Gifox](https://gifox.app/)** - Paid, excellent quality GIFs

### For Video Recording
- **QuickTime Player** - Built-in on macOS, simple and clean
- **OBS Studio** - Free, professional quality

### Settings
- Resolution: 1920x1080 or 1280x720
- GIF: 10-15 FPS, high quality
- Video: 30 FPS, H.264 codec
- Duration: 60-90 seconds for GIF, 2-3 minutes for video

## Pre-Recording Setup

1. **Clean inbox state** - Have 10-15 sample emails visible
2. **Dark mode enabled** - Looks better in demos
3. **Browser zoom** - Set to 100% or 110% for readability
4. **Close other tabs** - No distractions
5. **Hide bookmarks bar** - Cleaner look
6. **Sample data ready:**
   - At least one starred email
   - At least one snoozed email
   - At least one draft
   - Mix of Important/Other classified emails
   - A long email thread for thread view demo

## Demo Script (Recommended Order)

### Scene 1: First Impression (10 seconds)
**What to show:** The inbox in its default state

1. Open Hamba with inbox visible
2. Pause 2 seconds to let viewer see the clean UI
3. Show the sidebar with different views

### Scene 2: Keyboard Navigation (15 seconds)
**What to show:** Vim-style navigation speed

1. Press `j` several times to move down the email list
2. Press `k` to move back up
3. Press `g` to jump to top
4. Press `Shift+G` to jump to bottom
5. Press `o` or `Enter` to open an email
6. Press `u` or `Escape` to go back

**Tip:** Use smooth, deliberate keystrokes - not too fast, not too slow.

### Scene 3: Command Palette (10 seconds)
**What to show:** Quick access to any action

1. Press `Cmd+K` to open command palette
2. Type "archive" to filter commands
3. Use arrow keys to navigate options
4. Press `Escape` to close

### Scene 4: Split Inbox (10 seconds)
**What to show:** AI-powered email classification

1. Show the "Important" / "Other" tabs at top of inbox
2. Click "Important" - show curated important emails
3. Click "Other" - show newsletters, automated emails
4. Click "All" to show everything

### Scene 5: Snooze (10 seconds)
**What to show:** Hiding emails until later

1. Select an email with `j/k`
2. Press `h` to open snooze menu
3. Hover over options: "Later today", "Tomorrow", "Next week"
4. Select an option
5. Show the toast notification confirming snooze

### Scene 6: AI Compose (15 seconds)
**What to show:** AI-powered email writing

1. Press `c` to open compose
2. Add a recipient email
3. Press `Cmd+J` to open AI compose
4. Type a brief prompt like "politely decline a meeting invitation"
5. Show the AI generating the email content
6. (Optional) Make a small edit to personalize
7. Press `Escape` or cancel without sending

### Scene 7: Search (10 seconds)
**What to show:** Powerful full-text search

1. Press `/` to focus search
2. Type a search query (e.g., "from:john project")
3. Show results appearing
4. Show search highlighting in results
5. Press `Escape` to clear search

### Scene 8: Quick Actions (10 seconds)
**What to show:** Fast email triage

1. Navigate to an email
2. Press `s` to star (show star appear)
3. Press `s` again to unstar
4. Press `e` to archive (show toast with undo)
5. (Optional) Click "Undo" in toast

### Final Scene: Wrap Up (5 seconds)
**What to show:** Return to clean inbox

1. Show inbox again
2. Maybe show "Inbox Zero" if applicable
3. Fade out or end recording

## Alternative: Feature-Focused Clips

For social media or documentation, consider recording separate short clips:

### Clip 1: Navigation (5 seconds)
Just j/k navigation and opening/closing emails

### Clip 2: Command Palette (5 seconds)
Cmd+K, type, select, execute

### Clip 3: Split Inbox (5 seconds)
Switching between Important/Other/All

### Clip 4: Snooze (5 seconds)
h, select time, see confirmation

### Clip 5: AI Compose (10 seconds)
c, Cmd+J, prompt, see result

### Clip 6: Search (5 seconds)
/, query with operators, results

## Tips for a Great Demo

1. **Slow down** - What feels slow to you looks right on video
2. **Pause between actions** - Let viewers process what happened
3. **Use the keyboard** - That's Hamba's selling point
4. **Show the result** - After each action, pause to show the outcome
5. **No mistakes** - Re-record if you make errors (or edit them out)
6. **Clean data** - Use realistic but not-sensitive email subjects
7. **Good timing** - Each transition should feel natural

## Post-Recording

### For GIF
1. Trim to essential moments
2. Optimize file size (aim for < 5MB)
3. Consider adding a subtle loop point

### For Video
1. Add simple title cards if desired
2. Consider adding background music (optional)
3. Export at 1080p

## File Placement

Place the final demo file(s) in the repository root:

- `demo.gif` - Main demo GIF (for README)
- `demo.mp4` - Full video (for documentation/YouTube)

Update the README.md to include:

```markdown
<p align="center">
  <img src="demo.gif" alt="Hamba Demo" width="800" />
</p>
```

## Sample Email Subjects for Demo

Create realistic-looking test emails with subjects like:

- "Q4 Budget Review - Action Required"
- "Team lunch tomorrow?"
- "Your weekly digest from ProductHunt"
- "Re: Project timeline update"
- "Meeting notes from Monday standup"
- "Invoice #2847 attached"
- "Quick question about the API"
- "Newsletter: December highlights"
