# Steam Tracker for Google Sheets

A Google Apps Script that lives inside your Google Sheet and keeps a list of your Steam games up to date: achievements, hours played, last played, genre and more. It only tracks the games **you list on the sheet**, not your whole library. It can also post updates to a Discord channel.

No server, hosting or install is needed. Everything runs for free inside Google Sheets.

## Features

- **Achievements:** unlocked and total achievements for every game on your sheet, plus overall completion, a progress bar and a ✓ / X completion mark.
- **Playtime:** total hours played and the date you last played.
- **Family Sharing and free-to-play games:** games you don't own are found through the Steam store and still get achievements. They are labelled in the STATUS column.
- **Genre:** the top two genres from the Steam store, filled in once per game.
- **Store links:** every game name links to its Steam store page.
- **Fast:** requests go out in parallel and games are only re-checked when something changed.
- **Auto-update:** every 1 to 30 minutes, set from the menu.
- **Discord posts** (all optional):
  - Last played: hours, achievements, and how many you just earned.
  - 🏆 100% completion.
  - 📅 A weekly summary, based only on the games on your sheet.
- **Self-setting-up:** on a blank sheet it builds the headers, formulas, colours and totals row for you. New game rows get their formulas copied down automatically.
- **Sorting:** sort the game list A to Z, Z to A, by completion %, hours, last played or genre from the menu. Only the game table is sorted, so your other lists and the totals row stay put.
- **Add game rows:** type how many rows you want and the script extends the list, copies the formulas and fixes the totals.
- **Cell update rules:** choose, column by column, whether the script overwrites a cell or keeps what you typed (STATUS is always managed by the script).
- **RetroAchievements:** an optional second tab tracks your RetroAchievements games with the same columns (no store links, AppID or STATUS).
- **Settings menu:** every option is in the menu, so there is no need to edit code.

## What you need

- A Google account and a Google Sheet.
- Optional: a free RetroAchievements account and its Web API key (see the RetroAchievements section).
- A Steam account whose **Profile** and **Game details** are set to **Public**.
- STEAM GUARD AUTH IS REQUIRED FOR THE STEAM WEB API KEY!
- A free Steam Web API key (see step 1 below). Steam only issues keys to accounts that are not "limited" (an account that has spent at least $5 on Steam).
- Optional: a Discord server where you can create a webhook.

## Setup

### 1. Get your Steam API key and Steam ID

1. Go to <https://steamcommunity.com/dev/apikey>, sign in, and register a key. The domain name can be anything, for example `localhost`.
2. Find your **SteamID64** (a 17-digit number). Your Steam profile URL shows either that number or a custom name. Both work in the script, so you can use either. A tool like <https://steamid.io> also shows it.
3. Make your profile visible: in Steam open **Profile → Edit Profile → Privacy Settings** and set **My profile** and **Game details** to **Public**. Make sure *Always keep my total playtime private* is **not** ticked.

### 2. Add the script to your sheet

1. Open your Google Sheet (or create a blank one).
2. Go to **Extensions → Apps Script**.
3. Delete everything in the editor, then paste in the contents of `SteamTracker.gs` from this repository.
4. Click **Save**.
5. Go back to the sheet and **reload the page**. A **Steam Tracker** menu appears after a few seconds.

### 3. Enter your Steam details

1. Open **Steam Tracker → Settings → Set API key & Steam ID** and enter your key, then your Steam ID.
2. Google asks you to authorize the script the first time you run something. Click **Review permissions**, choose your account, and if you see *"Google hasn't verified this app"* click **Advanced → Go to … (unsafe) → Allow**. The warning appears because you are running your own script, which hasn't been through Google's review.

### 4. Set up the sheet

**Blank sheet (easiest):** run **Steam Tracker → Update now** (or **Set up blank sheet**). The script creates all the headers, formulas, colours and a totals row. Then type your game names under **GAME LIST** and run **Update now** again.

**Existing sheet:** make sure row 1 has these headers (the order and extra columns don't matter, and the matching ignores capital letters):

| Header | Filled by | Notes |
|---|---|---|
| `GAME LIST` | you | The game name. Required. |
| `APPID` | script | Required. You can type it yourself to force a specific game. |
| `COLLECTED ACHIES` | script | Required. |
| `TOTAL ACHIES` | script | Required. |
| `HOURS PLAYED` | script | Required. |
| `LAST PLAYED` | script | Required. |
| `LAST UPDATED` | script | Required. |
| `AMOUNT DONE`, `PROGRESS`, `COMPLETED` | formulas | Optional. Formulas are copied down to new game rows for you. |
| `GENRE` | script | Optional. Add a column with this header to turn it on. |
| `STATUS` | script | Optional. Added automatically to the empty column right after `LAST UPDATED`. |

Any other columns on the sheet are left alone.

### 5. Turn on auto-update

Run **Steam Tracker → Settings → Auto-update** to switch it on. It defaults to every 15 minutes, and you can change that in **Settings**.

### 6. Optional: Discord posts

1. In Discord, go to **Server Settings → Integrations → Webhooks → New Webhook**, pick a channel, and **Copy Webhook URL**.
2. In the sheet, run **Steam Tracker → Settings → Set Discord webhook** and paste it. A test message appears in the channel.

## Sorting the list

**Steam Tracker → Settings → Sort the list** offers: A to Z, Z to A, completion % (highest or lowest first), hours played, last played and genre. It only reorders the game table (the columns from `GAME LIST` to `STATUS`), so lists next to it and the totals row are never moved. Rows without data go last. 

Use this instead of Google Sheets' own sort or filter, which reorders the whole sheet and breaks things.

## Adding more game rows

**Settings → Add game rows…** asks how many rows to add (1 to 2000). New rows go in above the totals row, formulas and formatting are copied down, and the totals ranges are extended. **Game rows on a new sheet** sets how many rows a blank sheet starts with (default 250).

## Cell update rules

**Settings → Cell update rules** toggles each column between **overwrite** and **keep my edits**. With keep on, the script only fills the cell when it is empty. Defaults: APPID, UNLOCKED, TOTAL, HOURS, LAST PLAYED and LAST UPDATED are overwritten; GENRE and CONSOLE are kept. Hand-edited achievement counts are re-checked against Steam when set to overwrite. STATUS cannot be configured.

## RetroAchievements

### Connect your RetroAchievements account

1. Sign in at <https://retroachievements.org> (create a free account first if you don't have one).
2. Click your username in the top right, open **Settings**, and scroll to the **Keys** section.
3. Copy your **Web API Key**. Don't use the Connect key. It is the Web API key you need. Your **username** is the name shown on your profile.
4. In your Google Sheet, run **Steam Tracker → Settings → Set RetroAchievements username & key**.
5. Enter your username, then paste the key. The script checks them against RetroAchievements. If they are wrong it says so and saves nothing.
6. When it succeeds, it creates a second tab (default name `RetroAchievements`) with the headers: GAME LIST, CONSOLE, GENRE, COLLECTED ACHIES, HARDCORE ACHIES, TOTAL ACHIES, AMOUNT DONE, PROGRESS, COMPLETED, LAST PLAYED, LAST UPDATED, and turns RetroAchievements on.
7. Type game names under GAME LIST, then run **Update now**. If two games share a name, fill in CONSOLE (for example `SNES`) to pick the right one.

### Set up the RetroAchievements tab

Connecting your account creates the tab for you. You can also run **Steam Tracker → Set up RetroAchievements tab** at any time, before or after connecting. It creates the tab if it is missing (named after **Settings → RetroAchievements tab name**) and builds the headers, formulas, colours, progress bars and totals row. It only works on a blank tab, so it can't overwrite anything. The number of game rows comes from **Settings → Game rows on a new sheet**, and **Add game rows** can grow it later.

Your RetroAchievements key is stored in the script's private Script Properties, not in the code. To switch accounts, run step 4 again. Turn the tracking off or on with **Settings → RetroAchievements on/off**, and rename the tab with **Settings → RetroAchievements tab name**.

### What it does

It carries over Discord posts (last played, 100% completion, which says *Mastered in hardcore* when it applies), the weekly summary, sorting, update rules and totals. It does not have store links, AppID or STATUS. Problems (not found, ambiguous or fuzzy match) appear as a note on the game name cell. Games you have never played may not be found, because they only appear in your RetroAchievements history once you've earned something.

## The menu

| Item | What it does |
|---|---|
| **Update now** | Refreshes the sheet. |
| **Update + post last played to Discord** | Refreshes and posts your most recently played game. |
| **Post weekly summary now (preview)** | Posts the weekly summary right away without resetting the week. |
| **Diagnose selected game** | Click any cell in a game's row, then run this. It shows exactly what Steam returns for that game. |
| **Set up blank sheet** | Builds the layout. It only works on a completely empty tab, so it can't overwrite your data. |
| **Set up RetroAchievements tab** | Creates and sets up the RetroAchievements tab the same way. |
| **Settings** | The options below. |

### Settings

| Setting | Default |
|---|---|
| Steam API key & ID, Discord webhook | not set |
| Auto-update on/off and frequency (1, 5, 10, 15 or 30 min) | off / 15 |
| Sheet tab to update | `Sheet1` |
| Link game names to Steam | on |
| Genre column | on |
| Status column | on |
| Re-check games played in the last N hours | 6 |
| Discord last-played posts | on |
| Discord 100% posts | on |
| Discord weekly summary, with its day and hour (in your sheet's time zone) | on, Sunday 20:00 |

Settings are saved with the script, so pasting in a newer version of the code doesn't reset them. **Show all settings** lists them, and **Reset settings to defaults** restores them.

## How it works

1. It reads the names under **GAME LIST** and matches each to your Steam library (ignoring capitals, punctuation and ™/®).
2. Games it can't match are looked up in the Steam store, which finds Family Sharing and free-to-play games. If the store's match has a different name, STATUS says so, so you can check it.
3. It requests achievements for each game in parallel. A game is re-checked when its hours or last-played date changes, when it was played recently, when a previous check failed, and at least once every 24 hours.
4. It writes **only its own columns**. Your formulas and any other columns or lists are never touched.

**Things to know about Family Sharing:** Steam doesn't report total playtime for games you don't own, so HOURS PLAYED shows 0 for them unless you have played them in roughly the last two weeks. You can type hours in by hand and the script won't overwrite them.

## Discord posts

- **Last played:** after a game's hours change, it posts the game, total hours, achievements, and the number gained since the last post for that game.
- **100% complete:** a post when a game reaches every achievement. Games already at 100% when you first set it up are not announced.
- **Weekly summary:** hours played, achievements gained, top games, anything completed that week, and your sheet-wide totals. It only counts the games on your sheet, and games you add mid-week count from the day you add them. It needs auto-update on.

## Troubleshooting

**First step for any single game:** click a cell in its row and run **Steam Tracker → Diagnose selected game**.

| STATUS says | Meaning and fix |
|---|---|
| `OK` / `100% complete` | Everything worked. |
| `OK (not started)` | You have never launched the game, so Steam has no stats yet. The total comes from the game's achievement list and unlocked is 0. |
| `(family share)` / `(free to play)` | You don't own the game in your library. Achievements still work, but hours may not. |
| `matched "…", please verify` | The Steam store's closest match has a different name. If it is the wrong game, type the correct AppID into the APPID cell. |
| `Not found on Steam` | The name couldn't be matched. Fix the spelling or type the AppID. |
| `No achievements on Steam` | Steam says the game has none. Any numbers already on the sheet are kept. |
| `Steam has no stats for you in this game (numbers kept)` | Steam returned no stats for a game you have played. Your existing numbers are kept. |
| `Steam says your game details are private` | Set **Profile** and **Game details** to Public in Steam's privacy settings. |
| `Steam error (HTTP 429 / 5xx), will retry` | Steam was busy or rate limited. It retries automatically on the next update. |
| `Steam error (HTTP 403)` | Usually a wrong API key. Run **Set API key & Steam ID** again. |

**Other problems**

- **The menu doesn't appear:** reload the sheet and wait about 10 seconds. If it still doesn't, run `onOpen` once from the Apps Script editor.
- **"Steam returned no games":** your Game details are not public, or the Steam ID or API key is wrong.
- **An achievement was just unlocked but hasn't shown up:** Steam can lag by a few minutes, and the script re-checks recently played games on every update. Playing offline may delay it until Steam syncs.
- **Genres are blank:** the Steam store limits requests, so a large list may need a second **Update now** (the script tells you if some are still blank).
- **Discord posts don't arrive:** run **Set Discord webhook** again and check that the test message appears. The weekly summary and automatic posts only happen while auto-update is on.
- **Weekly summary arrives at the wrong time:** it uses the time zone in **File → Settings** of your sheet.

## Limits

Google Apps Script has daily quotas. A normal list updates well within them, but if you track thousands of games or run it every minute you may reach them. Steam's Web API also limits very fast request bursts, which the script handles by pausing and retrying.

## Privacy and security

- Your Steam API key, Steam ID and Discord webhook are stored in the script's private **Script Properties**, **not** in the code. It is safe to share or commit `SteamTracker.gs`.
- Never paste your API key or webhook URL into the code, a commit, or a public issue.
- The script talks only to Steam (`api.steampowered.com`, `store.steampowered.com`) and to your Discord webhook.

## Updating

Replace the code in **Extensions → Apps Script** with the newer `SteamTracker.gs`, save, and reload the sheet. Your settings and saved details are kept.
