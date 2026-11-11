# Steam Tracker for Google Sheets

A Google Apps Script that lives inside your Google Sheet and keeps a list of your games up to date: achievements, hours played, last played, completion date, genre and more. It tracks Steam, and optionally RetroAchievements on a second tab. It only tracks the games **you list on the sheet**, not your whole library, and it can post updates to a Discord channel.

No server, hosting or install is needed. Everything runs for free inside Google Sheets.

## Features

- **Achievements:** collected and total achievements for every game on your sheet, plus overall completion, a progress bar and a ✓ / X completion mark.
- **Playtime:** total hours played and the date you last played (Steam).
- **Date completed:** for 100% games, the date of the last achievement you earned (Steam and RetroAchievements).
- **Family Sharing and free-to-play games:** games you don't own are found through the Steam store and still get achievements.
- **Genre:** the top genres, filled in once per game.
- **Store links:** every Steam game name links to its store page.
- **Fast:** requests go out in parallel and games are only re-checked when something changed.
- **Auto-update:** every 1 to 30 minutes, set from the menu.
- **Discord posts** (all optional): last played with the names and descriptions of new achievements, 🏆 100% completions, and a 📅 weekly summary.
- **Backlog status:** an optional column (COMPLETED, IDLE, ACTIVE, BACKLOG) filled in automatically.
- **Sorting:** A to Z, Z to A, completion %, hours, last played, genre, backlog status, date completed.
- **RetroAchievements:** an optional second tab, including games you haven't played yet.
- **Self-setting-up:** on a blank sheet it builds the headers, formulas, colours and totals row. New rows get their formulas copied down, and **Add game rows** extends the list.
- **Cell update rules:** choose, column by column, whether the script overwrites a cell or keeps what you typed.
- **Settings menu:** every option is in the menu, grouped by category, so there is no need to edit code.

## What you need

- A Google account and a Google Sheet.
- A Steam account whose **Profile** and **Game details** are set to **Public**.
- A free Steam Web API key. To get one, your Steam account must have **Steam Guard Mobile Authenticator** turned on (set it up in the Steam mobile app), and must not be a "limited" account (one that has spent at least $5 on Steam).
- Optional: a free RetroAchievements account and its Web API key.
- Optional: a Discord server where you can create a webhook.

## Setup

### 1. Get your Steam API key and Steam ID

1. Turn on **Steam Guard Mobile Authenticator** if it isn't already: install the Steam mobile app, sign in, and choose **Steam Guard → Add Authenticator**. Steam needs it before it will issue an API key.
2. Go to <https://steamcommunity.com/dev/apikey>, sign in, and register a key. The domain name can be anything, for example `localhost`. Approve the request in the Steam mobile app if Steam asks.
3. Find your **SteamID64** (a 17-digit number). Your Steam profile URL shows either that number or a custom name, and both work in the script. A tool like <https://steamid.io> also shows it.
4. Make your profile visible: in Steam open **Profile → Edit Profile → Privacy Settings** and set **My profile** and **Game details** to **Public**. Make sure *Always keep my total playtime private* is **not** ticked.

### 2. Add the script to your sheet

1. Open your Google Sheet (or create a blank one).
2. Go to **Extensions → Apps Script**.
3. Delete everything in the editor, then paste in the contents of `SteamTracker.gs`.
4. Click **Save**, then go back to the sheet and **reload the page**. A **Steam Tracker** menu appears after a few seconds.

### 3. Enter your Steam details

1. Open **Steam Tracker → Settings → Accounts → Steam API key & Steam ID** and enter your key, then your Steam ID.
2. Google asks you to authorize the script the first time you run something. Click **Review permissions**, choose your account, and if you see *"Google hasn't verified this app"* click **Advanced → Go to … (unsafe) → Allow**. The warning appears because you are running your own script, which hasn't been through Google's review.

### 4. Set up the sheet

**Blank sheet (easiest):** run **Steam Tracker → Update now** (or **Tools → Set up blank sheet**). The script creates all the headers, formulas, colours and a totals row. Then type your game names under **GAME LIST** and run **Update now** again.

**Existing sheet:** make sure row 1 has these headers (the order and extra columns don't matter, and capital letters are ignored):

| Header | Filled by | Notes |
|---|---|---|
| `GAME LIST` | you | The game name. Required. |
| `APPID` | script | Required. You can type it yourself to force a specific game. |
| `COLLECTED ACHIES` | script | Required. |
| `TOTAL ACHIES` | script | Required. |
| `HOURS PLAYED` | script | Required. |
| `LAST PLAYED` | script | Required. |
| `LAST UPDATED` | script | Required. |
| `DATE COMPLETED` | script | Optional. **Tools → Add DATE COMPLETED column** adds it before `LAST UPDATED`. |
| `AMOUNT DONE`, `PROGRESS`, `COMPLETED` | formulas | Optional. Copied down to new game rows for you. |
| `GENRE` | script | Optional. Add a column with this header to turn it on. |
| `STATUS` | script | Optional. Added automatically to the empty column right after `LAST UPDATED`. |
| `BACKLOG STATUS` | script | Optional. See below. |

Any other columns on the sheet are left alone.

### 5. Turn on auto-update

Run **Steam Tracker → Settings → Updates → Auto-update**. It defaults to every 15 minutes, and you can change that in the same menu.

### 6. Optional: Discord posts

1. In Discord, go to **Server Settings → Integrations → Webhooks → New Webhook**, pick a channel, and **Copy Webhook URL**. Links from Discord Canary, PTB and other clients work too.
2. In the sheet, run **Steam Tracker → Settings → Accounts → Discord webhook** and paste it. A test message appears in the channel.

## The menu

| Menu | What it has |
|---|---|
| **Update now**, **Update + post last played to Discord**, **Post weekly summary now (preview)** | The everyday actions. |
| **Sort the list** | The sort options and the sort range. |
| **Tools** | Diagnose selected game, Send test 100% post to Discord, Add game rows, Add BACKLOG STATUS column, Add DATE COMPLETED column, Set up blank sheet, Set up RetroAchievements tab. |
| **Settings → Accounts** | Steam API key and ID, RetroAchievements username and key, Discord webhook. |
| **Settings → Updates** | Auto-update on/off and frequency (1, 5, 10, 15 or 30 min), how long a recently played game keeps being re-checked. |
| **Settings → Sheets & columns** | Tab names, RetroAchievements on/off, rows on a new sheet, store links, genre and status columns. |
| **Settings → Backlog status** | The IDLE cutoff and the status colours. |
| **Settings → Cell update rules** | Overwrite or keep your edits, per column. |
| **Settings → Discord** | Last-played, 100% and weekly posts, and the weekly day and hour. |
| **Settings → Show all settings / Reset** | Lists every setting, or restores the defaults. |

Settings are saved with the script, so pasting in a newer version of the code doesn't reset them.

## Date completed

The `DATE COMPLETED` column holds the date of the **last achievement you earned** in a game you've finished at 100%. It is blank for games below 100%, and it clears if a game gets new achievements (for example DLC) until you finish again.

- **Steam:** the date comes from the unlock times Steam already reports for your earned achievements. A finished game with no date is fetched straight away, so adding the column fills in your existing 100% games on the next update. If Steam has no unlock times for a game, the cell stays blank.
- **RetroAchievements:** the date of your most recent earned achievement in that game (hardcore or softcore).
- **Add it:** **Tools → Add DATE COMPLETED column** inserts it between `LAST PLAYED` and `LAST UPDATED` on the tab you are looking at. New blank sheets include it.
- **Sort:** **Sort the list → Date completed (newest first / oldest first)**. Games without a date go last.
- **Rule:** under **Cell update rules** you can set `DATE COMPLETED` to keep your edits.

## Backlog status column

Run **Tools → Add BACKLOG STATUS column** to add it to the tab you are looking at (Steam or RetroAchievements). It inserts a `BACKLOG STATUS` column directly left of GAME LIST and fills it. Everything to its right shifts over by one, and formulas, links and lists move with it. Running it again just refreshes the column. You can also add it by hand: make a column anywhere on the sheet with the header `BACKLOG STATUS` (`PLAY STATUS` or `BACKLOG` also work).

On every update the script writes text into the column:

| Status | When |
|---|---|
| **COMPLETED** | Every achievement is unlocked. |
| **IDLE** | You have played it (hours or achievements) but not for the set number of months. |
| **ACTIVE** | You have played it more recently than that. |
| **BACKLOG** | No hours and no achievements yet. |

- **Settings → Backlog status → Mark IDLE after N months** sets the cutoff (default 6; 0 turns IDLE off).
- **Settings → Cell update rules → BACKLOG STATUS** chooses between *script overwrites* (default) and *keep my edits*, where a status you type stays and the script only fills blank cells.
- A cell that holds your own formula is never overwritten.
- Games with no recorded hours (Family Share, RetroAchievements) count as played once they have any achievements. A game with no last played date never becomes IDLE.
- The column moves with its row when you sort.

### Colours (optional)

**Settings → Backlog status → Colour the status cells** lets the script colour the cells (off by default). Click **COMPLETED**, **ACTIVE**, **IDLE** or **BACKLOG** to change a colour. The defaults are COMPLETED `#d9d2e9` (lavender), ACTIVE `#d9ead3` (green), IDLE `#ffe599` (yellow) and BACKLOG `#f4cccc` (red). Type a hex code such as `#d9ead3`, a name (red, green, blue, yellow, orange, purple, pink, teal, grey, white), or `none`. **Reset to the default colours** puts them back.

The colours use conditional formatting, and the script manages only the four rules for the status column. When colours are on, any colour rules of your own for those four words in that column are replaced. Turning colours off removes the script's rules.

### Chip dropdowns (optional)

A script can't create Google's coloured chip dropdowns, but you can add them by hand in a minute. The script keeps writing the text, and the chip shows it. Use either these chips or the script colours above, not both.

1. Click the first game cell in the BACKLOG STATUS column (for example `A2`). Press **Ctrl+Shift+Down** (**Cmd+Shift+Down** on a Mac) to select down to the last game row. Don't include the header or the totals row.
2. Choose **Insert → Dropdown**. A side panel opens.
3. Under criteria choose **Dropdown**, then add four items, spelled exactly as the script writes them, in capitals: `COMPLETED`, `IDLE`, `PLAYED`, `BACKLOG`.
4. Click the coloured dot next to each item and pick a colour.
5. Open **Advanced options**, set **If the data is invalid** to **Show a warning**, and set **Display style** to **Chip**.
6. Click **Done**. The existing text turns into coloured chips.

The script never removes chips, dropdowns or colours you add yourself, and **Add game rows** copies them into new rows. A red triangle in a cell means its text doesn't match one of the four items exactly.

## Sorting the list

**Steam Tracker → Sort the list** offers:

- A to Z and Z to A.
- Completion % (highest or lowest first), hours played (most first), last played (newest first), genre.
- **Backlog status, then A to Z:** groups the list in the order BACKLOG, ACTIVE, IDLE, COMPLETED, each group A to Z. Rows with no status go last. Needs the BACKLOG STATUS column.
- **Date completed (newest or oldest first):** needs the DATE COMPLETED column. Games without a date go last.

Sorting only reorders the game table, so lists next to it and the totals row are never moved. Rows without data go last. **Sort range** limits the sort to columns you choose, for example `A:L`. Use these instead of Google Sheets' own sort or filter, which reorders the whole sheet and breaks things.

## Adding more game rows

**Tools → Add game rows…** asks how many rows to add (1 to 2000). New rows go in above the totals row, formulas, formatting and dropdowns are copied down, and the totals ranges are extended. **Settings → Sheets & columns → Game rows on a new sheet** sets how many rows a blank sheet starts with (default 250).

## Cell update rules

**Settings → Cell update rules** toggles each column between **overwrite** and **keep my edits**. With keep on, the script only fills the cell when it is empty. Defaults: GENRE and CONSOLE are kept, everything else is overwritten. Hand-edited achievement counts are re-checked against Steam when set to overwrite. STATUS cannot be configured.

## RetroAchievements

### Connect your account

1. Sign in at <https://retroachievements.org> (create a free account first if you don't have one).
2. Click your username in the top right, open **Settings**, and scroll to the **Keys** section.
3. Copy your **Web API Key**. Don't use the Connect key. Your **username** is the name shown on your profile.
4. In your Google Sheet, run **Steam Tracker → Settings → Accounts → RetroAchievements username & key**.
5. Enter your username, then paste the key. The script checks them against RetroAchievements. If they are wrong it says so and saves nothing.
6. When it succeeds, it creates a second tab (default name `RetroAchievements`) with the headers GAME LIST, CONSOLE, GENRE, COLLECTED ACHIES, HARDCORE ACHIES, TOTAL ACHIES, AMOUNT DONE, PROGRESS, COMPLETED, LAST PLAYED, DATE COMPLETED, LAST UPDATED, and turns RetroAchievements on.
7. Type game names under GAME LIST, then run **Update now**.

You can also run **Tools → Set up RetroAchievements tab** at any time, before or after connecting. It only works on a blank tab, so it can't overwrite anything. Turn the tracking on or off and rename the tab under **Settings → Sheets & columns**.

### How games are found

- **Games you have played:** matched by title from your RetroAchievements history, with your real collected and hardcore counts.
- **Games you haven't played yet (or that aren't in your history):** the script searches the RetroAchievements game lists, takes the game's **total achievements**, and shows **collected and hardcore as 0**. CONSOLE is filled in for you. As soon as you earn something in it, your real numbers replace the zeros.
- **Fill in CONSOLE** (for example `SNES`, `GBA`, `Game Boy Advance`, `PlayStation`) to search just that console's list. This is quicker, and it's how you pick the right one when a title exists on several consoles. Without a console the script searches every console, which can take a few updates the first time. Game lists are cached for 6 hours and found games are remembered, so it doesn't repeat the work.
- **Titles that can't be matched** get a note on the game name cell (hover to read it): not found, found on several consoles, or a close match to verify. Hacks, homebrew and subsets are skipped.
- Games with no achievements on RetroAchievements aren't in the game lists, so they show as not found.

The RetroAchievements tab carries over Discord posts (last played, 100% completion which says *Mastered in hardcore* when it applies), the weekly summary, sorting, update rules and totals. It has no store links, AppID, hours or STATUS column.

## Test the 100% post

**Tools → Send test 100% post to Discord** sends a sample 100% post so you can see the cover and layout. It uses a finished game from your sheet (one per tab if both tabs have one), or an example game if nothing is finished yet. The title is marked **TEST**, and nothing is recorded, so real posts and the weekly summary are not affected. If Discord rejects it, the script tells you to set the webhook again.

## Discord posts

- **Last played:** after a game's hours change, it posts the game, total hours, achievements, and the number gained since the last post for that game.
- **New achievements:** the post lists each achievement you earned, with its name and description, as a list when there are several (up to 10 shown, then "…and N more"). It works for Steam and RetroAchievements. Achievements you earned before the script first saw the game are not listed, and hidden Steam achievements may have no description. If an update catches several games at once, each game's achievements are held and listed in that game's next post.
- **100% complete:** a post when a game reaches every achievement, with the game's cover image (Steam's header image, or the game icon for RetroAchievements) and the final achievements you earned listed. Games already at 100% when you first set it up are not announced.
- **Weekly summary:** hours played, achievements gained, top games, anything completed that week, and your sheet-wide totals. It only counts the games on your sheet, and games you add mid-week count from the day you add them. It needs auto-update on.

## How it works

1. It reads the names under **GAME LIST** and matches each to your Steam library (ignoring capitals, punctuation and ™/®).
2. Games it can't match are looked up in the Steam store, which finds Family Sharing and free-to-play games.
3. It requests achievements for each game in parallel. A game is re-checked when its hours or last-played date changes, when it was played recently, when a previous check failed, when it is 100% with no completion date yet, and at least once every 24 hours.
4. It writes **only its own columns**. Your formulas and any other columns or lists are never touched.

**Family Sharing:** Steam doesn't report total playtime for games you don't own, so HOURS PLAYED shows 0 for them unless you have played them in roughly the last two weeks. You can type hours in by hand and set **Cell update rules → HOURS PLAYED** to keep your edits.

## Troubleshooting

**First step for any single game:** click a cell in its row and run **Steam Tracker → Tools → Diagnose selected game**.

The STATUS column holds a short label. **Hover over the cell** for a note explaining it.

| STATUS says | Meaning and fix |
|---|---|
| `OK` / `Complete` | Everything worked. |
| `Not started` | You have never launched the game, so Steam has no stats yet. The total comes from the game's achievement list and collected is 0. |
| `· Shared` | You don't own the game in your library (Family Sharing). Achievements still work, but hours may not. |
| `· Free` | The game is free to play and counts as owned. Achievements work, but Steam doesn't always report its hours. |
| `· Check match` | The Steam store's closest match has a different name. If it is the wrong game, type the correct AppID into the APPID cell. |
| `Not owned` | The game wasn't found in your library or on the Steam store under that name, so it is treated as not owned. Fix the spelling, or type the AppID into APPID if you do have access to it. |
| `No achievements` | Steam says the game has none. Any numbers already on the sheet are kept. |
| `No stats` | Steam returned no stats for a game you have played. Your existing numbers are kept. |
| `Not owned or private` | Steam returned no data for the game: either you don't have it, or your Steam **Profile** and **Game details** are private. If you own it, set both to Public in Steam's privacy settings. |
| `Retrying` | Steam was busy or returned an error (the note shows the code). It retries on the next update. HTTP 403 usually means a wrong API key: enter it again under **Accounts**. |

**Other problems**

- **The menu doesn't appear:** reload the sheet and wait about 10 seconds. If it still doesn't, run `onOpen` once from the Apps Script editor.
- **"Steam returned no games":** your Game details are not public, or the Steam ID or API key is wrong.
- **An achievement was just unlocked but hasn't shown up:** Steam can lag by a few minutes, and the script re-checks recently played games on every update. Playing offline may delay it until Steam syncs.
- **Genres are blank:** the Steam store limits requests, so a large list may need a second **Update now** (the script tells you if some are still blank).
- **A RetroAchievements game isn't found:** read the note on its name cell. Fill in CONSOLE, or check the spelling against retroachievements.org.
- **Discord posts don't arrive:** run **Discord webhook** under **Accounts** again and check that the test message appears. The weekly summary and automatic posts only happen while auto-update is on.
- **Weekly summary arrives at the wrong time:** it uses the time zone in **File → Settings** of your sheet.

## Limits

Google Apps Script has daily quotas. A normal list updates well within them, but if you track thousands of games or run it every minute you may reach them. Steam's and RetroAchievements' web APIs limit very fast request bursts, which the script handles by pausing and retrying.

## Privacy and security

- Your Steam API key, Steam ID, RetroAchievements key and Discord webhook are stored in the script's private **Script Properties**, **not** in the code. It is safe to share or commit `SteamTracker.gs`.
- Never paste your keys or webhook URL into the code, a commit, or a public issue.
- The script talks only to Steam (`api.steampowered.com`, `store.steampowered.com`), RetroAchievements (`retroachievements.org`) and your Discord webhook.

## Updating

Replace the code in **Extensions → Apps Script** with the newer `SteamTracker.gs`, save, and reload the sheet. Your settings and saved details are kept. See `CHANGELOG.md` for what changed.

## License

Add the license of your choice here, for example MIT.
