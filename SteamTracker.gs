/**
 * Steam Tracker for Google Sheets
 * Updates playtime + achievement progress, ONLY for games listed on your sheet,
 * and posts your last played game to Discord.
 *
 * Sheet layout (your GAMES TO PLAT sheet): row 1 = headers, game names under "GAME LIST".
 * The script fills in these columns by header name:
 *   APPID | COLLECTED ACHIES | TOTAL ACHIES | HOURS PLAYED | LAST PLAYED | LAST UPDATED
 * It never touches AMOUNT DONE / COMPLETED (your formulas) or the lists in the other columns
 * (WHO TO BLAME, GAMES TO BUY, WHEEL OF GAMES).
 * A STATUS column is added in the empty column right after LAST UPDATED (skipped if it isn't empty).
 * An optional GENRE column is filled automatically if you add a column with that header.
 * New game rows get the AMOUNT DONE / PROGRESS / COMPLETED formulas copied down automatically.
 * On a completely blank sheet, the headers, formulas, colours and totals row are created for you.
 * Game names become links to their Steam store pages (Settings > Link game names).
 * A row whose game name is just "TOTAL(S)", "OVERALL" or "SUMMARY" ends the game list.
 * If you already know a game's AppID, type it in and it will be used instead of name matching.
 *
 * Speed: Steam is queried in parallel, and a game's achievements are only re-fetched
 * when its playtime/last-played changed (or it was played in the last few hours).
 * Family-shared games are always re-fetched because Steam gives no playtime for them.
 */

// ---------- Settings ----------
// Everything below can be changed from the menu: Steam Tracker > Settings. These are only the defaults.
const DEFAULTS = {
  sheetName: 'Sheet1',   // tab to update (falls back to the first tab if it isn't found)
  autoMinutes: 15,       // auto-update frequency; Google allows 1, 5, 10, 15 or 30
  recentHours: 6,        // games played within this many hours are always re-checked (catches mid-session achievements)
  statusColumn: true,    // fill the STATUS column
  genreColumn: true,     // fill the GENRE column (if the sheet has one)
  linkNames: true,       // turn game names into links to their Steam store pages
  postLastPlayed: true,  // Discord: post after a play session
  postCompletion: true,  // Discord: post when a game reaches 100%
  weeklyOn: true,        // Discord: weekly summary
  weeklyDay: 0,          // 0 = Sunday ... 6 = Saturday, in the sheet's time zone
  weeklyHour: 20,        // 0-23
  autoOn: false          // remembers whether auto-update was turned on from the menu
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Fixed behaviour (not shown in the menu).
const STATUS_HEADER = 'STATUS';
const GENRE_HEADER = 'GENRE';
const STALE_HOURS = 24;            // every game's achievements are re-fetched at least this often, even if nothing seems to have changed
const GENRE_TIME_BUDGET_SEC = 200; // max time per run spent on genre lookups; the rest continues next run

// Layout created on a blank sheet (and by Steam Tracker > Set up blank sheet).
const LAYOUT = ['GAME LIST', 'GENRE', 'APPID', 'COLLECTED ACHIES', 'TOTAL ACHIES', 'AMOUNT DONE', 'PROGRESS',
  'COMPLETED', 'HOURS PLAYED', 'LAST PLAYED', 'LAST UPDATED', 'STATUS'];
const LAST_GAME_ROW = 256;   // formulas are filled down to here; the totals row sits right below it

// Header names on your sheet (case-insensitive). Change these if you rename a column.
const NAME_HEADERS = ['game list', 'game', 'name', 'title', 'game name'];
const OUT_COLS = {
  appid: 'APPID',
  unlocked: 'COLLECTED ACHIES',
  total: 'TOTAL ACHIES',
  hours: 'HOURS PLAYED',
  lastPlayed: 'LAST PLAYED',
  updated: 'LAST UPDATED'
};

// ---------- Menu & settings ----------

function cfg_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('SETTINGS');
    return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function setCfg_(patch) {
  const props = PropertiesService.getScriptProperties();
  let saved = {};
  try { saved = JSON.parse(props.getProperty('SETTINGS') || '{}'); } catch (e) { /* start fresh */ }
  props.setProperty('SETTINGS', JSON.stringify(Object.assign(saved, patch)));
}

function autoUpdateOn_() {
  try {
    return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'updateSteamSheet');
  } catch (e) { // menus opened by the simple onOpen trigger can't list triggers
    return !!cfg_().autoOn;
  }
}

function onOpen() { buildMenu_(); }

function buildMenu_() {
  const ui = SpreadsheetApp.getUi();
  const c = cfg_();
  const onOff = b => (b ? 'ON' : 'OFF');
  const settings = ui.createMenu('Settings')
    .addItem('Set API key & Steam ID', 'setupCredentials')
    .addItem('Set Discord webhook', 'setupDiscord')
    .addSeparator()
    .addItem('Auto-update: ' + (autoUpdateOn_() ? 'ON (click to turn off)' : 'OFF (click to turn on)'), 'toggleAutoUpdate')
    .addItem('Auto-update every ' + c.autoMinutes + ' min (change)', 'settingAutoMinutes')
    .addSeparator()
    .addItem('Sheet tab: ' + c.sheetName + ' (change)', 'settingSheetName')
    .addItem('Link game names: ' + onOff(c.linkNames), 'toggleLinkNames')
    .addItem('Genre column: ' + onOff(c.genreColumn), 'toggleGenre')
    .addItem('Status column: ' + onOff(c.statusColumn), 'toggleStatus')
    .addItem('Re-check games played in last ' + c.recentHours + ' h (change)', 'settingRecentHours')
    .addSeparator()
    .addItem('Discord last-played posts: ' + onOff(c.postLastPlayed), 'toggleLastPlayed')
    .addItem('Discord 100% posts: ' + onOff(c.postCompletion), 'toggleCompletion')
    .addItem('Discord weekly summary: ' + onOff(c.weeklyOn), 'toggleWeekly')
    .addItem('Weekly summary time: ' + DAY_NAMES[c.weeklyDay] + ' ' + c.weeklyHour + ':00 (change)', 'settingWeeklyTime')
    .addSeparator()
    .addItem('Show all settings', 'showSettings')
    .addItem('Reset settings to defaults', 'resetSettings');
  ui.createMenu('Steam Tracker')
    .addItem('Update now', 'updateSteamSheet')
    .addItem('Update + post last played to Discord', 'updateAndPostNow')
    .addItem('Post weekly summary now (preview)', 'postWeeklyNow')
    .addSeparator()
    .addItem('Diagnose selected game', 'diagnoseGame')
    .addItem('Set up blank sheet', 'setupSheet')
    .addSubMenu(settings)
    .addToUi();
}

function toggle_(key, label) {
  const now = !cfg_()[key];
  setCfg_({ [key]: now });
  buildMenu_();
  alert_(label + ' is now ' + (now ? 'ON' : 'OFF') + '.');
}
function toggleLinkNames() { toggle_('linkNames', 'Linking game names'); }
function toggleGenre() { toggle_('genreColumn', 'The GENRE column'); }
function toggleStatus() { toggle_('statusColumn', 'The STATUS column'); }
function toggleLastPlayed() { toggle_('postLastPlayed', 'Last-played posts'); }
function toggleCompletion() { toggle_('postCompletion', '100% completion posts'); }
function toggleWeekly() { toggle_('weeklyOn', 'The weekly summary'); }

function toggleAutoUpdate() {
  if (autoUpdateOn_()) { removeTriggers(); buildMenu_(); alert_('Auto-update turned off.'); }
  else installAutoUpdate();
}

// Asks for a value; returns the trimmed text, or null if cancelled.
function ask_(title, text) {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
}

function settingSheetName() {
  const v = ask_('Sheet tab', 'Name of the tab to update (currently "' + cfg_().sheetName + '"):');
  if (v === null || v === '') return;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(v)) {
    alert_('There is no tab called "' + v + '". Nothing was changed.');
    return;
  }
  setCfg_({ sheetName: v });
  buildMenu_();
  alert_('Now updating the "' + v + '" tab.');
}

function settingAutoMinutes() {
  const v = ask_('Auto-update frequency', 'Minutes between updates. Google allows 1, 5, 10, 15 or 30 (currently ' + cfg_().autoMinutes + '):');
  if (v === null) return;
  const n = Number(v);
  if ([1, 5, 10, 15, 30].indexOf(n) === -1) { alert_('Please enter 1, 5, 10, 15 or 30. Nothing was changed.'); return; }
  setCfg_({ autoMinutes: n });
  if (autoUpdateOn_()) installAutoUpdate(); // restart the schedule with the new frequency
  else { buildMenu_(); alert_('Saved. Turn auto-update on to use it.'); }
}

function settingRecentHours() {
  const v = ask_('Re-check recently played games', 'Games played within this many hours are always re-checked for new achievements (1-72, currently ' + cfg_().recentHours + '):');
  if (v === null) return;
  const n = Number(v);
  if (!(n >= 1 && n <= 72)) { alert_('Please enter a number from 1 to 72. Nothing was changed.'); return; }
  setCfg_({ recentHours: Math.round(n) });
  buildMenu_();
  alert_('Saved.');
}

function settingWeeklyTime() {
  const c = cfg_();
  const d = ask_('Weekly summary day', 'Which day? (Sunday, Monday, ... or 0-6 where 0 = Sunday). Currently ' + DAY_NAMES[c.weeklyDay] + ':');
  if (d === null) return;
  let day = /^[0-6]$/.test(d) ? Number(d) : DAY_NAMES.findIndex(n => n.toLowerCase().indexOf(d.toLowerCase()) === 0 && d.length >= 3);
  if (day < 0) { alert_('I couldn\'t read that day. Nothing was changed.'); return; }
  const h = ask_('Weekly summary hour', 'Which hour, 0-23 (20 = 8 PM), in the sheet\'s time zone? Currently ' + c.weeklyHour + ':');
  if (h === null) return;
  const hour = Number(h);
  if (h === '' || !(hour >= 0 && hour <= 23)) { alert_('Please enter an hour from 0 to 23. Nothing was changed.'); return; }
  setCfg_({ weeklyDay: day, weeklyHour: Math.floor(hour) });
  buildMenu_();
  alert_('Weekly summary set for ' + DAY_NAMES[day] + ' at ' + Math.floor(hour) + ':00.');
}

function showSettings() {
  const c = cfg_();
  const onOff = b => (b ? 'ON' : 'OFF');
  alert_([
    'Sheet tab: ' + c.sheetName,
    'Auto-update: ' + (autoUpdateOn_() ? 'ON, every ' + c.autoMinutes + ' min' : 'OFF (would run every ' + c.autoMinutes + ' min)'),
    'Re-check games played in last ' + c.recentHours + ' h',
    'Link game names: ' + onOff(c.linkNames),
    'Genre column: ' + onOff(c.genreColumn),
    'Status column: ' + onOff(c.statusColumn),
    'Discord last-played posts: ' + onOff(c.postLastPlayed),
    'Discord 100% posts: ' + onOff(c.postCompletion),
    'Discord weekly summary: ' + onOff(c.weeklyOn) + ' (' + DAY_NAMES[c.weeklyDay] + ' ' + c.weeklyHour + ':00)',
    'Steam key / ID: ' + (PropertiesService.getScriptProperties().getProperty('STEAM_API_KEY') ? 'saved' : 'NOT set'),
    'Discord webhook: ' + (PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK') ? 'saved' : 'NOT set')
  ].join('\n'));
}

function resetSettings() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset all settings to their defaults? (Your Steam key and Discord webhook are kept.)', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const wasOn = autoUpdateOn_();
  PropertiesService.getScriptProperties().deleteProperty('SETTINGS');
  setCfg_({ autoOn: wasOn });
  if (wasOn) installAutoUpdate(); else buildMenu_();
}

function setupCredentials() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const k = ui.prompt('Steam Web API key',
    'Get one free at https://steamcommunity.com/dev/apikey', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;

  const s = ui.prompt('Steam ID',
    'Your 17-digit SteamID64, or your custom profile name (the part after /id/ in your profile URL).',
    ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;

  props.setProperty('STEAM_API_KEY', k.getResponseText().trim());
  props.setProperty('STEAM_ID', s.getResponseText().trim());
  ui.alert('Saved. Now run Steam Tracker > Update now.');
}

// Entry points (separate functions so trigger events aren't mistaken for arguments).
function updateSteamSheet() { run_(false, false); }
function updateAndPostNow() { run_(true, false); }
function postWeeklyNow() { run_(false, true); }

function run_(force, weeklyNow) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('STEAM_API_KEY');
  let steamId = props.getProperty('STEAM_ID');
  if (!key || !steamId) {
    alert_('Run Steam Tracker > Set API key & Steam ID first.');
    return;
  }
  if (!/^\d{17}$/.test(steamId)) {
    steamId = resolveVanity_(key, steamId);
    props.setProperty('STEAM_ID', steamId);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().sheetName) || ss.getSheets()[0];
  if (isBlankSheet_(sheet)) {
    setupLayout_(sheet);
    alert_('Blank sheet set up. Type your game names under GAME LIST, then run Steam Tracker > Update now.');
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const tz = ss.getSpreadsheetTimeZone();

  // --- Find columns by header (nothing is created except the optional status column) ---
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h).trim().toLowerCase().replace(/\s+/g, ' '));

  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) throw new Error('Could not find a "GAME LIST" column in row 1.');

  const col = {};
  Object.keys(OUT_COLS).forEach(k => {
    const i = headers.indexOf(OUT_COLS[k].toLowerCase());
    if (i === -1) throw new Error('Could not find a "' + OUT_COLS[k] + '" column in row 1.');
    col[k] = i;
  });

  col.genre = cfg_().genreColumn ? headers.indexOf(GENRE_HEADER.toLowerCase()) : -1;

  col.status = -1;
  if (cfg_().statusColumn) {
    const i = headers.indexOf(STATUS_HEADER.toLowerCase());
    if (i !== -1) {
      col.status = i;
    } else if (col.updated + 1 >= lastCol || headers[col.updated + 1] === '') {
      // Use the empty column right after LAST UPDATED, styled like that header.
      col.status = col.updated + 1;
      const target = sheet.getRange(1, col.status + 1);
      sheet.getRange(1, col.updated + 1).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      target.setValue(STATUS_HEADER);
    }
  }

  // Only the game rows in the name column (other columns like GAMES TO BUY can be longer).
  const nameCol = sheet.getRange(2, nameIdx + 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  let numRows = nameCol.length;
  // A "TOTALS"-style label row ends the list, so its formulas are never read back or overwritten.
  const endIdx = nameCol.findIndex(r => /^(totals?|overall|summary)$/i.test(String(r[0]).trim()));
  if (endIdx !== -1) numRows = endIdx;
  while (numRows > 0 && String(nameCol[numRows - 1][0]).trim() === '') numRows--;
  if (numRows === 0) return;

  // Copy the AMOUNT DONE / PROGRESS / COMPLETED formulas down to any game row that is missing them.
  fillFormulas_(sheet, headers, nameIdx, col, numRows);

  // Read one block spanning the columns we use (we only ever WRITE our own columns, one by one).
  const used = Object.keys(col).map(k => col[k]).filter(i => i >= 0).concat([nameIdx]);
  const minC = Math.min.apply(null, used);
  const maxC = Math.max.apply(null, used);
  const data = sheet.getRange(2, minC + 1, numRows, maxC - minC + 1).getValues();
  const cell = (row, idx) => row[idx - minC];

  // --- Library + recently played, fetched in parallel ---
  const base = 'https://api.steampowered.com/IPlayerService/';
  const [ownedRes, recentRes] = UrlFetchApp.fetchAll([
    { url: base + 'GetOwnedGames/v1/?key=' + key + '&steamid=' + steamId +
        '&include_appinfo=1&include_played_free_games=1&format=json', muteHttpExceptions: true },
    { url: base + 'GetRecentlyPlayedGames/v1/?key=' + key + '&steamid=' + steamId + '&format=json',
        muteHttpExceptions: true }
  ]);
  if (ownedRes.getResponseCode() !== 200) {
    throw new Error('Steam API error ' + ownedRes.getResponseCode() + ' (check your API key).');
  }
  const games = (JSON.parse(ownedRes.getContentText()).response || {}).games || [];
  if (!games.length) {
    throw new Error('Steam returned no games. Make sure your profile and "Game details" are set to Public.');
  }
  const byName = {};
  const byId = {};
  games.forEach(g => { byName[norm_(g.name)] = g; byId[g.appid] = g; });

  const recent = {};
  if (recentRes.getResponseCode() === 200) {
    ((JSON.parse(recentRes.getContentText()).response || {}).games || []).forEach(g => { recent[g.appid] = g; });
  }

  const freeMap = JSON.parse(props.getProperty('FREE_MAP') || '{}');
  let freeMapChanged = false;
  const nowSec = Math.floor(Date.now() / 1000);
  const day = d => (d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '');

  // --- Pass 1: match each sheet row to a Steam app and decide if it needs a refresh ---
  const items = [];
  data.forEach((row, i) => {
    const title = String(cell(row, nameIdx)).trim();
    if (!title) return;

    let game = null;
    let shared = false;
    let free = false;
    let note = '';
    const existingId = Number(cell(row, col.appid));
    if (existingId && byId[existingId]) game = byId[existingId];
    if (!game) game = byName[norm_(title)];

    if (!game) {
      // Not in your own library: free-to-play or Family Sharing. Find the AppID via the store.
      let appid = existingId || 0;
      if (!appid) {
        const hit = storeSearch_(title);
        if (hit) {
          appid = hit.id;
          if (norm_(hit.name) !== norm_(title)) note = ' - matched "' + hit.name + '", please verify';
        }
      }
      if (!appid) {
        items.push({ i: i, title: title, missing: true });
        return;
      }
      if (byId[appid]) {
        game = byId[appid]; // you own it; the sheet name just differed from the store name
      } else {
        game = recent[appid] || { appid: appid };
        shared = true;
        if (freeMap[appid] === undefined) { freeMap[appid] = isFree_(appid) ? 1 : 0; freeMapChanged = true; }
        free = freeMap[appid] === 1;
      }
    }

    // Decide whether achievements need re-fetching.
    const hoursNow = game.playtime_forever !== undefined ? Math.round(game.playtime_forever / 6) / 10 : undefined;
    const gDay = game.rtime_last_played ? day(new Date(game.rtime_last_played * 1000)) : '';
    const playedRecently = game.rtime_last_played && (nowSec - game.rtime_last_played) < cfg_().recentHours * 3600;
    const hasData = cell(row, col.unlocked) !== '';
    const statusText = col.status >= 0 ? String(cell(row, col.status)) : '';
    const lastFetch = cell(row, col.updated);
    const stale = !(lastFetch instanceof Date) || (nowSec * 1000 - lastFetch.getTime()) > STALE_HOURS * 3600 * 1000;
    const failedBefore = /^Steam (error|says)/.test(statusText); // a failed fetch is retried on the next run
    const need = force || shared || !hasData || note !== '' || stale || failedBefore ||
      existingId !== game.appid ||
      hoursNow !== cell(row, col.hours) ||
      gDay !== day(cell(row, col.lastPlayed)) ||
      playedRecently;

    items.push({ i: i, title: title, game: game, shared: shared, free: free, note: note,
                 hoursNow: hoursNow, need: need });
  });

  // --- Pass 2: fetch all needed achievements in parallel (in batches) ---
  const toFetch = items.filter(it => it.need && !it.missing);
  const fetchAch = list => UrlFetchApp.fetchAll(list.map(it => ({
    url: 'https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=' + key +
      '&steamid=' + steamId + '&appid=' + it.game.appid + '&format=json',
    muteHttpExceptions: true
  })));
  const CHUNK = 30;
  for (let s = 0; s < toFetch.length; s += CHUNK) {
    const batch = toFetch.slice(s, s + CHUNK);
    const resps = fetchAch(batch);
    batch.forEach((it, n) => { it.ach = parseAch_(resps[n]); });
    // Rate limit / server hiccup: pause and try those games once more right away.
    const retry = batch.filter(it => it.ach.err);
    if (retry.length) {
      Utilities.sleep(5000);
      const again = fetchAch(retry);
      retry.forEach((it, n) => { it.ach = parseAch_(again[n]); });
    }
    if (s + CHUNK < toFetch.length) Utilities.sleep(300);
  }

  // Steam has no stats yet for games you've never launched, even though they have achievements.
  // Get the total from the game's global achievement list instead (and show 0 unlocked).
  const noStats = toFetch.filter(it => it.ach.none === 'nostats');
  if (noStats.length) {
    const resps = UrlFetchApp.fetchAll(noStats.map(it => ({
      url: 'https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=' +
        it.game.appid + '&format=json',
      muteHttpExceptions: true
    })));
    noStats.forEach((it, n) => {
      let total = 0;
      try {
        total = (JSON.parse(resps[n].getContentText()).achievementpercentages.achievements || []).length;
      } catch (e) { /* no list: the game has no achievements */ }
      // Only treat it as "0 unlocked" for a game you've never played; otherwise keep the numbers already on the sheet.
      const existing = cell(data[it.i], col.unlocked);
      const neverPlayed = it.hoursNow === 0 || (it.hoursNow === undefined && (existing === '' || existing === 0));
      it.ach = total === 0 ? { none: 'none' }
        : neverPlayed ? { unlocked: 0, total: total, lastUnlock: 0, notStarted: true }
        : { none: 'nostats' };
    });
  }

  // --- Genres: fill blank GENRE cells from the Steam store, paced to respect its rate limit ---
  const genreOf = {};
  let genresLeft = 0;
  if (col.genre >= 0) {
    const need = items.filter(it => !it.missing && String(cell(data[it.i], col.genre)).trim() === '');
    const started = Date.now();
    let s = 0;
    while (s < need.length && Date.now() - started < GENRE_TIME_BUDGET_SEC * 1000) {
      const batch = need.slice(s, s + 10);
      const resps = UrlFetchApp.fetchAll(batch.map(it => ({
        url: 'https://store.steampowered.com/api/appdetails?appids=' + it.game.appid + '&cc=us&l=english',
        muteHttpExceptions: true
      })));
      let limited = false;
      batch.forEach((it, n) => {
        const code = resps[n].getResponseCode();
        if (code === 429 || code === 403) { limited = true; return; } // rate limited: retried below
        genreOf[it.i] = parseGenre_(resps[n], it.game.appid);
      });
      if (limited) { Utilities.sleep(30000); continue; } // rate limited: wait, then redo this batch
      s += 10;
      Utilities.sleep(3000);
    }
    genresLeft = need.filter(it => !genreOf[it.i]).length;
  }

  // --- Pass 3: fill the output columns ---
  const out = {};
  Object.keys(col).forEach(k => {
    if (col[k] >= 0) out[k] = data.map(r => [cell(r, col[k])]);
  });
  const setStatus = (i, text) => { if (out.status) out.status[i] = [text]; };
  const now = new Date();
  const tracked = [];

  items.forEach(it => {
    const i = it.i;
    if (it.missing) {
      setStatus(i, 'Not found on Steam');
      return;
    }
    const game = it.game;
    out.appid[i] = [game.appid];
    if (it.hoursNow !== undefined) out.hours[i] = [it.hoursNow];
    else if (out.hours[i][0] === '') out.hours[i] = [0]; // no hours recorded (e.g. family share): show 0
    if (game.rtime_last_played) out.lastPlayed[i] = [new Date(game.rtime_last_played * 1000)];
    if (out.genre && genreOf[i]) out.genre[i] = [genreOf[i]];

    let ach = null;
    if (it.need) {
      const tag = (it.shared ? (it.free ? ' (free to play)' : ' (family share)') : '') + it.note;
      const r = it.ach;
      if (r.err) {
        // Steam hiccup: keep the old values and leave LAST UPDATED alone; it is retried on the next run.
        setStatus(i, 'Steam error (' + r.err + '), will retry' + tag);
      } else if (r.none === 'private') {
        setStatus(i, 'Steam says your game details are private (check Privacy settings)' + tag);
      } else if (r.none === 'nostats') {
        setStatus(i, 'Steam has no stats for you in this game (numbers kept)' + tag);
        out.updated[i] = [now];
      } else if (r.none) {
        // Steam says this game has no achievements: keep whatever numbers are already on your sheet.
        setStatus(i, 'No achievements on Steam' + tag);
        out.updated[i] = [now];
      } else {
        ach = r;
        out.unlocked[i] = [ach.unlocked];
        out.total[i] = [ach.total];
        setStatus(i, (ach.total && ach.unlocked === ach.total ? '100% complete' : (ach.notStarted ? 'OK (not started)' : 'OK')) + tag);
        out.updated[i] = [now];
      }
    }

    tracked.push({
      title: it.title,
      appid: game.appid,
      hours: out.hours[i][0],
      unlocked: out.unlocked[i][0],
      total: out.total[i][0],
      // "Last played" = latest play time Steam reports, or latest achievement unlock (covers shared games).
      lastTs: Math.max(game.rtime_last_played || 0, ach ? ach.lastUnlock : 0)
    });
  });

  // --- Write back (only our columns; AMOUNT DONE / COMPLETED formulas and other lists are untouched) ---
  Object.keys(out).forEach(k => {
    sheet.getRange(2, col[k] + 1, numRows, 1).setValues(out[k]);
  });
  sheet.getRange(2, col.lastPlayed + 1, numRows, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, col.updated + 1, numRows, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // --- Link each game name to its Steam store page (the name text itself is unchanged) ---
  if (cfg_().linkNames) {
    const nameRange = sheet.getRange(2, nameIdx + 1, numRows, 1);
    const rich = nameRange.getRichTextValues();
    let linksChanged = false;
    items.forEach(it => {
      if (it.missing || !it.game) return;
      const url = 'https://store.steampowered.com/app/' + it.game.appid + '/';
      if (rich[it.i][0].getLinkUrl() !== url) {
        rich[it.i][0] = rich[it.i][0].copy().setLinkUrl(url).build(); // keeps existing text formatting
        linksChanged = true;
      }
    });
    if (linksChanged) nameRange.setRichTextValues(rich);
  }

  if (freeMapChanged) props.setProperty('FREE_MAP', JSON.stringify(freeMap));
  notifyDiscord_(tracked, force, weeklyNow, tz);
  if (genresLeft > 0) alert_(genresLeft + ' genres are still blank (Steam store rate limit). Run Update now again in a few minutes.');
}

// ---------- Discord ----------

function setupDiscord() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Discord webhook URL',
    'In Discord: Server Settings > Integrations > Webhooks > New Webhook > pick the channel > Copy Webhook URL.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = r.getResponseText().trim();
  if (url.indexOf('https://discord.com/api/webhooks/') !== 0 &&
      url.indexOf('https://discordapp.com/api/webhooks/') !== 0) {
    ui.alert('That doesn\'t look like a Discord webhook URL.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('DISCORD_WEBHOOK', url);
  postDiscord_({ content: 'Steam Tracker is connected \u2705' });
  ui.alert('Saved. A test message was sent to your channel.');
}

// Script properties hold up to ~9 KB per value, so bigger state is stored in 8 KB chunks.
function loadJson_(props, key) {
  const n = props.getProperty(key + '_n');
  let txt;
  if (n !== null) {
    txt = '';
    for (let i = 0; i < Number(n); i++) txt += props.getProperty(key + '_' + i) || '';
  } else {
    txt = props.getProperty(key); // older single-value format
  }
  if (txt === null || txt === undefined) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}

function saveJson_(props, key, obj) {
  const txt = JSON.stringify(obj);
  const old = Number(props.getProperty(key + '_n') || 0);
  const parts = [];
  for (let i = 0; i < txt.length; i += 8000) parts.push(txt.slice(i, i + 8000));
  parts.forEach((p, i) => props.setProperty(key + '_' + i, p));
  for (let i = parts.length; i < old; i++) props.deleteProperty(key + '_' + i);
  props.setProperty(key + '_n', String(parts.length));
  props.deleteProperty(key);
}

const isNum_ = v => typeof v === 'number' && !isNaN(v);
const isComplete_ = t => isNum_(t.unlocked) && isNum_(t.total) && t.total > 0 && t.unlocked === t.total;
const round1_ = n => Math.round(n * 10) / 10;

/**
 * Discord posts, all based ONLY on the games listed on your sheet (never your whole library):
 *  1. Last played: when a game's hours change (you finished a session).
 *  2. 100% completion: when a game reaches all of its achievements.
 *  3. Weekly summary: once a week (Settings > Weekly summary), or on demand with weeklyNow.
 * force = true posts your most recently played game regardless.
 */
function notifyDiscord_(tracked, force, weeklyNow, tz) {
  const props = PropertiesService.getScriptProperties();
  const hook = props.getProperty('DISCORD_WEBHOOK');
  if (!hook) return;

  const c = cfg_();
  const seen = loadJson_(props, 'SEEN') || {};   // appid -> [hours, unlocked, total] as of the last run
  const base = loadJson_(props, 'BASE') || {};   // appid -> unlocked as of the last post for that game
  const doneRaw = loadJson_(props, 'DONE');      // appid -> 1 for games already at 100%
  const done = doneRaw || {};
  const gamesAt100 = () => tracked.filter(isComplete_).length;

  // ----- 2. 100% completion -----
  const completed = [];
  tracked.forEach(t => {
    const id = t.appid;
    if (isComplete_(t)) {
      if (!done[id]) {
        done[id] = 1;
        // Not announced the first time the script runs, or when an already-finished game is added to the sheet.
        if (doneRaw !== null && seen[id] !== undefined) completed.push(t);
      }
    } else if (done[id]) {
      delete done[id]; // e.g. a DLC added more achievements; announce again when it's finished again
    }
  });

  // ----- 1. Last played -----
  const byRecent = arr => arr.slice().sort((a, b) => b.lastTs - a.lastTs)[0];
  const changed = tracked.filter(t => {
    const s = seen[t.appid];
    if (!s) return false;
    return isNum_(t.hours) && isNum_(s[0]) ? t.hours !== s[0] : t.unlocked !== s[1];
  });

  // A game that just hit 100% gets its own completion post, so it doesn't also get a "last played" post.
  const sessions = changed.filter(t => completed.indexOf(t) === -1);
  let pick = null;
  if (force) pick = byRecent(tracked.filter(t => t.lastTs > 0));
  else if (sessions.length) pick = byRecent(sessions);

  if (pick && (force || c.postLastPlayed)) {
    const hoursTxt = isNum_(pick.hours) ? pick.hours + ' h' : 'n/a';
    const achTxt = isNum_(pick.unlocked) ? pick.unlocked + ' / ' + pick.total : 'No achievements';
    let newTxt = 'n/a';
    if (isNum_(pick.unlocked)) {
      const b = base[pick.appid];
      newTxt = isNum_(b) ? '+' + Math.max(0, pick.unlocked - b) : 'First check';
    }
    const embed = {
      title: '🎮 Last played: ' + pick.title,
      color: 0x1b2838,
      fields: [
        { name: 'Total hours', value: hoursTxt, inline: true },
        { name: 'Achievements', value: achTxt, inline: true },
        { name: 'New since last post', value: newTxt, inline: true }
      ]
    };
    if (pick.lastTs > 0) embed.timestamp = new Date(pick.lastTs * 1000).toISOString();
    postDiscord_({ embeds: [embed] });
    if (isNum_(pick.unlocked)) base[pick.appid] = pick.unlocked;
  }

  // ----- 2. (continued) post the completions -----
  (c.postCompletion ? completed : []).forEach(t => {
    postDiscord_({
      embeds: [{
        title: '🏆 100% complete: ' + t.title,
        description: 'Every achievement unlocked!',
        color: 0xf1c40f,
        fields: [
          { name: 'Achievements', value: t.unlocked + ' / ' + t.total, inline: true },
          { name: 'Total hours', value: isNum_(t.hours) ? t.hours + ' h' : 'n/a', inline: true },
          { name: 'Games at 100%', value: gamesAt100() + ' / ' + tracked.length, inline: true }
        ]
      }]
    });
    Utilities.sleep(500);
  });

  // ----- 3. Weekly summary -----
  const weekRaw = loadJson_(props, 'WEEK_BASE');  // appid -> [hours, unlocked] at the start of the week
  const week = weekRaw || {};
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(new Date(), tz, 'u')) % 7;      // Sunday = 0
  const hourNow = Number(Utilities.formatDate(new Date(), tz, 'H'));
  const scheduled = c.weeklyOn && dow === c.weeklyDay && hourNow >= c.weeklyHour && props.getProperty('WEEKLY_LAST') !== today;
  let resetWeek = false;

  if (weekRaw !== null && (scheduled || weeklyNow)) {
    let hours = 0, achs = 0;
    const per = [];
    const finished = [];
    tracked.forEach(t => {
      const b = week[t.appid];
      if (!b) return; // added to the sheet this week: starts counting from now
      const dh = isNum_(t.hours) && isNum_(b[0]) ? Math.max(0, t.hours - b[0]) : 0;
      const da = isNum_(t.unlocked) && isNum_(b[1]) ? Math.max(0, t.unlocked - b[1]) : 0;
      hours += dh;
      achs += da;
      if (dh > 0 || da > 0) per.push({ title: t.title, dh: dh, da: da });
      if (isComplete_(t) && isNum_(b[1]) && b[1] < t.total) finished.push(t.title);
    });
    per.sort((x, y) => (y.dh - x.dh) || (y.da - x.da));

    const played = per.filter(p => p.dh > 0).length;
    const lines = per.slice(0, 5).map(p =>
      '• ' + p.title + ' — ' + (p.dh > 0 ? round1_(p.dh) + ' h' : '0 h') + (p.da > 0 ? ', +' + p.da + ' achievements' : ''));
    const sum = k => tracked.reduce((n, t) => n + (isNum_(t[k]) ? t[k] : 0), 0);
    const totAch = sum('total'), gotAch = sum('unlocked');

    const fields = [
      { name: 'Hours played', value: round1_(hours) + ' h', inline: true },
      { name: 'Achievements unlocked', value: '+' + achs, inline: true },
      { name: 'Games played', value: String(played), inline: true }
    ];
    if (lines.length) fields.push({ name: 'Top games', value: lines.join('\n').slice(0, 1000) });
    if (finished.length) fields.push({ name: '🏆 Completed this week', value: finished.join(', ').slice(0, 1000) });
    fields.push({
      name: 'Your sheet overall',
      value: gotAch + ' / ' + totAch + ' achievements (' + (totAch ? Math.round(gotAch / totAch * 1000) / 10 : 0) + '%)\n' +
        round1_(sum('hours')) + ' h total • ' + gamesAt100() + ' / ' + tracked.length + ' games at 100%'
    });

    postDiscord_({
      embeds: [{
        title: '📅 Weekly summary' + (weeklyNow && !scheduled ? ' (preview)' : ''),
        description: per.length ? 'Games on your sheet only.' : 'Quiet week: no playtime or new achievements.',
        color: 0x5865f2,
        fields: fields
      }]
    });
    if (scheduled && !weeklyNow) { props.setProperty('WEEKLY_LAST', today); resetWeek = true; }
  }

  // ----- Save state for the next run -----
  const newSeen = {};
  tracked.forEach(t => {
    newSeen[t.appid] = [t.hours, t.unlocked, t.total];
    if (!isNum_(base[t.appid]) && isNum_(t.unlocked)) base[t.appid] = t.unlocked;
    // The weekly baseline starts at setup, restarts after each weekly post, and picks up new games as they appear.
    if (resetWeek || !week[t.appid]) week[t.appid] = [t.hours, t.unlocked];
  });
  try {
    saveJson_(props, 'SEEN', newSeen);
    saveJson_(props, 'BASE', base);
    saveJson_(props, 'DONE', done);
    saveJson_(props, 'WEEK_BASE', week);
  } catch (e) { /* storage full: notifications may repeat */ }
}

function postDiscord_(payload) {
  const hook = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK');
  if (!hook) return;
  UrlFetchApp.fetch(hook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ---------- troubleshooting ----------

// Click any cell in a game's row, then run this to see exactly what Steam says about that game.
function diagnoseGame() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('STEAM_API_KEY');
  let steamId = props.getProperty('STEAM_ID');
  if (!key || !steamId) { alert_('Set your API key & Steam ID first (Settings).'); return; }
  if (!/^\d{17}$/.test(steamId)) steamId = resolveVanity_(key, steamId);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h).trim().toLowerCase().replace(/\s+/g, ' '));
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  const idIdx = headers.indexOf(OUT_COLS.appid.toLowerCase());
  if (row < 2 || nameIdx === -1) { alert_('Click a cell in a game\'s row first (not the header row).'); return; }

  const name = String(sheet.getRange(row, nameIdx + 1).getValue()).trim();
  let appid = idIdx >= 0 ? Number(sheet.getRange(row, idIdx + 1).getValue()) : 0;
  const lines = ['Game: ' + name];
  if (!appid) {
    const hit = storeSearch_(name);
    appid = hit ? hit.id : 0;
    lines.push(hit ? 'No AppID on the sheet. Store search found "' + hit.name + '" (' + appid + ').'
                   : 'No AppID on the sheet and the Steam store has no match for that name. Check the spelling or type the AppID.');
  } else {
    lines.push('AppID: ' + appid);
  }
  if (!appid) { alert_(lines.join('\n')); return; }

  const owned = UrlFetchApp.fetch('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=' + key +
    '&steamid=' + steamId + '&include_played_free_games=1&format=json', { muteHttpExceptions: true });
  if (owned.getResponseCode() === 200) {
    const g = (((JSON.parse(owned.getContentText()).response || {}).games) || []).filter(x => x.appid === appid)[0];
    lines.push(g ? 'In your library: yes (' + Math.round(g.playtime_forever / 6) / 10 + ' h played)'
                 : 'In your library: no (family share or free-to-play, so hours are unavailable)');
  } else {
    lines.push('Could not read your library (HTTP ' + owned.getResponseCode() + '). Is the API key right and Game details public?');
  }

  const res = UrlFetchApp.fetch('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=' + key +
    '&steamid=' + steamId + '&appid=' + appid + '&format=json', { muteHttpExceptions: true });
  const r = parseAch_(res);
  lines.push('Achievements request: HTTP ' + res.getResponseCode());
  lines.push(r.err ? 'Result: Steam error (' + r.err + '). Usually temporary; it retries on the next update.'
    : r.none === 'private' ? 'Result: Steam says your game details are private. Set Profile and Game details to Public.'
    : r.none === 'nostats' ? 'Result: Steam has no stats for you in this game yet (never launched). The total is taken from the game\'s achievement list.'
    : r.none ? 'Result: this game has no achievements on Steam.'
    : 'Result: ' + r.unlocked + ' of ' + r.total + ' achievements unlocked.');
  lines.push('Steam said: ' + res.getContentText().slice(0, 160));
  alert_(lines.join('\n'));
}

// ---------- blank sheet setup ----------

function isBlankSheet_(sheet) {
  return sheet.getLastRow() === 0 || sheet.getLastColumn() === 0;
}

// Menu entry: only ever acts on a completely empty sheet, so it can't overwrite your data.
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().sheetName) || ss.getSheets()[0];
  if (!isBlankSheet_(sheet)) {
    alert_('The "' + sheet.getName() + '" tab already has content, so nothing was changed. ' +
      'The layout is only created on a completely blank sheet.');
    return;
  }
  setupLayout_(sheet);
  alert_('Sheet set up. Type your game names under GAME LIST, then run Update now.');
}

// Relative R1C1 reference from column index `to` to column index `from` on the same row.
function rc_(from, to) { return from === to ? 'RC' : 'RC[' + (from - to) + ']'; }

/**
 * For each formula column (AMOUNT DONE, PROGRESS, COMPLETED) that exists on the sheet, any game row whose
 * cell is completely empty gets the formula from the row above it (or a standard one if there is none).
 * Cells that already hold a formula or your own value are never touched.
 */
function fillFormulas_(sheet, headers, nameIdx, col, numRows) {
  const amount = headers.indexOf('amount done');
  if (amount === -1) return;
  const progress = headers.indexOf('progress');
  const completed = headers.indexOf('completed');
  const targets = [
    { idx: amount, def: '=IFERROR(IF(OR(' + rc_(col.unlocked, amount) + '="",' + rc_(col.total, amount) + '=""),"",' +
        rc_(col.unlocked, amount) + '/' + rc_(col.total, amount) + '),"")' }
  ];
  if (progress !== -1) {
    const a = rc_(amount, progress);
    targets.push({ idx: progress,
      def: '=IF(' + a + '="","",SPARKLINE(MIN(' + a + ',1),{"charttype","bar";"max",1;"color1","#34a853"}))' });
  }
  if (completed !== -1) {
    const a = rc_(amount, completed);
    targets.push({ idx: completed,
      def: '=IF(' + rc_(nameIdx, completed) + '="","",IFS(' + a + '>=5,"?",' + a + '>=1,"✓",TRUE,"X"))' });
  }

  targets.forEach(t => {
    const rng = sheet.getRange(2, t.idx + 1, numRows, 1);
    const f = rng.getFormulasR1C1();
    const v = rng.getValues();
    let last = null;
    const fills = []; // [firstRowIndex, lastRowIndex, formula]
    for (let i = 0; i < numRows; i++) {
      if (f[i][0] !== '') { last = f[i][0]; continue; }
      if (v[i][0] !== '') continue;                      // your own content: leave it
      const formula = last !== null ? last : t.def;
      const prev = fills[fills.length - 1];
      if (prev && prev[1] === i - 1 && prev[2] === formula) prev[1] = i; else fills.push([i, i, formula]);
    }
    fills.forEach(fl => {
      const n = fl[1] - fl[0] + 1;
      const rows = [];
      for (let k = 0; k < n; k++) rows.push([fl[2]]);
      sheet.getRange(2 + fl[0], t.idx + 1, n, 1).setFormulasR1C1(rows);
    });
  });
}

function colLetter_(idx) { // 0 -> A
  let n = idx + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function setupLayout_(sheet) {
  const totalsRow = LAST_GAME_ROW + 1;
  const n = LAYOUT.length;
  if (sheet.getMaxRows() < totalsRow) sheet.insertRowsAfter(sheet.getMaxRows(), totalsRow - sheet.getMaxRows());
  if (sheet.getMaxColumns() < n) sheet.insertColumnsAfter(sheet.getMaxColumns(), n - sheet.getMaxColumns());

  const L = {};                                   // header -> column letter
  LAYOUT.forEach((h, i) => { L[h] = colLetter_(i); });
  const at = h => LAYOUT.indexOf(h) + 1;          // header -> 1-based column number

  // Headers
  sheet.getRange(1, 1, 1, n).setValues([LAYOUT])
    .setFontWeight('bold').setBackground('#1b2838').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Formulas for AMOUNT DONE, PROGRESS and COMPLETED, filled down for future games
  const rows = [];
  for (let r = 2; r <= LAST_GAME_ROW; r++) {
    const done = L['AMOUNT DONE'] + r;
    rows.push([
      '=IFERROR(IF(OR(' + L['COLLECTED ACHIES'] + r + '="",' + L['TOTAL ACHIES'] + r + '=""),"",' +
        L['COLLECTED ACHIES'] + r + '/' + L['TOTAL ACHIES'] + r + '),"")',
      '=IF(' + done + '="","",SPARKLINE(MIN(' + done + ',1),{"charttype","bar";"max",1;"color1","#34a853"}))',
      '=IF(' + L['GAME LIST'] + r + '="","",IFS(' + done + '>=5,"?",' + done + '>=1,"✓",TRUE,"X"))'
    ]);
  }
  sheet.getRange(2, at('AMOUNT DONE'), rows.length, 3).setFormulas(rows);

  // Number formats
  sheet.getRange(2, at('AMOUNT DONE'), rows.length, 1).setNumberFormat('0.00%');
  sheet.getRange(2, at('HOURS PLAYED'), rows.length, 1).setNumberFormat('0.0');
  sheet.getRange(2, at('LAST PLAYED'), rows.length, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, at('LAST UPDATED'), rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // COMPLETED colours
  const cr = sheet.getRange(2, at('COMPLETED'), rows.length, 1);
  sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('✓').setBackground('#b7e1cd').setRanges([cr]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('X').setBackground('#f4c7c3').setRanges([cr]).build()
  ]));

  // Totals row
  const tr = totalsRow;
  const sum = h => '=SUM(' + L[h] + '2:' + L[h] + LAST_GAME_ROW + ')';
  sheet.getRange(tr, at('COLLECTED ACHIES')).setFormula(sum('COLLECTED ACHIES'));
  sheet.getRange(tr, at('TOTAL ACHIES')).setFormula(sum('TOTAL ACHIES'));
  sheet.getRange(tr, at('AMOUNT DONE')).setFormula(
    '=IFERROR(' + L['COLLECTED ACHIES'] + tr + '/' + L['TOTAL ACHIES'] + tr + ',"")').setNumberFormat('0.0%');
  sheet.getRange(tr, at('PROGRESS')).setFormula(
    '=IF(' + L['AMOUNT DONE'] + tr + '="","",SPARKLINE(MIN(' + L['AMOUNT DONE'] + tr + ',1),' +
    '{"charttype","bar";"max",1;"color1","#34a853"}))');
  sheet.getRange(tr, at('COMPLETED')).setFormula(
    '=COUNTIF(' + L['COMPLETED'] + '2:' + L['COMPLETED'] + LAST_GAME_ROW + ',"✓") & " / " & COUNTA(' +
    L['GAME LIST'] + '2:' + L['GAME LIST'] + LAST_GAME_ROW + ')');
  sheet.getRange(tr, at('HOURS PLAYED')).setFormula(sum('HOURS PLAYED')).setNumberFormat('#,##0.0" hrs"');
  sheet.getRange(tr, 1, 1, n).setFontWeight('bold');

  sheet.setColumnWidth(1, 260);
}

// ---------- helpers ----------

// Store genres as "Action, Adventure". Returns '' on a temporary error (retried next run), 'Unknown' if the store has no entry.
function parseGenre_(res, appid) {
  if (res.getResponseCode() !== 200) return '';
  try {
    const entry = JSON.parse(res.getContentText())[appid];
    if (!entry || !entry.success || !entry.data) return 'Unknown';
    const names = (entry.data.genres || []).map(g => g.description)
      .filter(n => !/^(free to play|early access)$/i.test(n));
    return names.slice(0, 2).join(', ') || 'Unknown';
  } catch (e) {
    return '';
  }
}

// Returns {unlocked,total,lastUnlock}, or {none: reason} when Steam has no achievements for this game
// ('none', 'nostats' = never launched, 'private' = game details hidden), or {err: 'HTTP ###'} on a hiccup.
function parseAch_(res) {
  const code = res.getResponseCode();
  let ps = null;
  try { ps = JSON.parse(res.getContentText()).playerstats; } catch (e) { /* not JSON */ }
  const msg = ps && ps.error ? String(ps.error) : '';

  if (code === 200 && ps && ps.success) {
    if (!ps.achievements) return { none: 'none' };       // the game has stats but no achievements
    const got = ps.achievements.filter(a => a.achieved === 1);
    const lastUnlock = got.reduce((m, a) => Math.max(m, a.unlocktime || 0), 0);
    return { unlocked: got.length, total: ps.achievements.length, lastUnlock: lastUnlock };
  }
  if (/not public|private/i.test(msg)) return { none: 'private' };
  if (/no stats/i.test(msg)) return { none: 'nostats' };
  if (code === 400 && ps) return { none: 'none' };
  return { err: 'HTTP ' + code };                        // 403 with no message = bad API key; 429/5xx = hiccup
}

// Looks up a game's AppID on the Steam store by name. Prefers an exact (normalized) name match.
function storeSearch_(title) {
  const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(title) +
    '&l=english&cc=us';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const items = JSON.parse(res.getContentText()).items || [];
  if (!items.length) return null;
  const exact = items.filter(it => norm_(it.name) === norm_(title))[0];
  return exact || items[0];
}

// True if the Steam store lists the app as free to play.
function isFree_(appid) {
  try {
    const res = UrlFetchApp.fetch('https://store.steampowered.com/api/appdetails?appids=' + appid +
      '&filters=basic&cc=us', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return false;
    const entry = JSON.parse(res.getContentText())[appid];
    return !!(entry && entry.success && entry.data && entry.data.is_free);
  } catch (e) {
    return false;
  }
}

function resolveVanity_(key, vanity) {
  const res = UrlFetchApp.fetch('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=' + key +
    '&vanityurl=' + encodeURIComponent(vanity), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Steam API error ' + res.getResponseCode() + ' (check your API key).');
  }
  const r = JSON.parse(res.getContentText());
  if (!r.response || r.response.success !== 1) throw new Error('Could not resolve Steam profile name "' + vanity + '".');
  return r.response.steamid;
}

function norm_(s) {
  return String(s).toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]/g, '');
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function installAutoUpdate() {
  removeTriggers();
  const m = cfg_().autoMinutes;
  ScriptApp.newTrigger('updateSteamSheet').timeBased().everyMinutes(m).create();
  setCfg_({ autoOn: true });
  alert_('Auto-update turned on (every ' + m + ' minutes).');
  buildMenu_();
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateSteamSheet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  setCfg_({ autoOn: false });
}
