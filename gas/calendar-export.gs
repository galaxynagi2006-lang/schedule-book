/**
 * スマートスケジュール帳：Googleカレンダー・manaba（Gmail）との連携と通知を行う Apps Script
 * @OnlyCurrentDoc
 *
 * ■ いちばん簡単な使い方（配布用テンプレートのスプレッドシートから）
 *  1. 配られたリンクを開き「コピーを作成」する（コード入りのスプレッドシートが自分のドライブにできる）
 *  2. スプレッドシートのメニュー「スケジュール帳」→「① 初期設定」を押して、表示される許可を「許可」する
 *     （設定シートの作成・合言葉の作成・自動実行（通知）の設定をまとめて行う）
 *  3. 「拡張機能」→「Apps Script」→「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員 → 「デプロイ」
 *  4. メニュー「スケジュール帳」→「② アプリに登録する情報」のQRコードをスマホのカメラで読み取る
 *     （アプリが開いて連携が自動で登録される。パソコンなら「このパソコンのアプリに登録する」を押す）
 *  設定（バイトのキーワード、通知の時刻など）は、シート「設定」の「値」の列を書き換えるだけで変えられる。
 *
 * ■ 単体のスクリプトとして使う場合（以前からの方法）
 *  https://script.google.com で新しいプロジェクトを作ってこのコードを貼り付け、下の DEFAULT_CONFIG を直接書き換える。
 *  自動実行は関数「setupTriggers」、試しのまとめメールは「morningSummary」を選んで「▶ 実行」する。
 *
 * ■ できること
 *  - アプリ用（doGet）: カレンダーのバイト予定と、manaba の課題・提出状況をアプリに渡す
 *    （合言葉 WRITE_TOKEN が設定されていれば、アプリから同じ合言葉が送られたときだけ渡す）
 *  - シフト表の書き込み（doPost）: 合言葉（WRITE_TOKEN）が一致したときだけカレンダーに予定を作る
 *  - 1時間ごと: manaba の締切をカレンダーに「📩 締切：〜」として登録（提出したら ✅）、バイト前の確認メール
 *  - 毎朝: 今日のバイトと締切が近い課題のまとめメール
 *    （スクリプト プロパティに GEMINI_API_KEY を入れると AI のひとこと付き）
 *
 * ■ 注意
 *  - データは使う人それぞれの Google アカウントの中だけで処理され、アプリの開発者には送られない。
 *  - 合言葉を設定していない場合、ウェブアプリのURLを知っている人はバイトの予定と課題の一覧を見られる。
 *  - コードを変更したら「デプロイを管理」→ 編集（鉛筆）→ バージョン「新バージョン」で更新する（URLは変わらない）。
 *  - 配布用のテンプレートでは「① 初期設定」を実行しないこと（合言葉などがコピー先に引き継がれてしまう）。
 */

// 設定の初期値。シート「設定」に値が書かれていれば、そちらが優先される
const DEFAULT_CONFIG = {
  CALENDAR_ID: '',                          // バイトの予定があるカレンダーのID。空ならメインのカレンダー
  KEYWORDS: ['バイト', 'アルバイト', 'シフト'], // タイトルにどれかを含む予定をバイトとして扱う（空なら全部）
  DAYS_BACK: 7,                             // アプリに渡す期間：何日前から
  DAYS_AHEAD: 62,                           //               何日後まで（翌月分のシフトも入るように約2か月）
  WRITE_TOKEN: '',                          // 合言葉（アプリが読むとき・シフト表を書き込むときに必要）
  WEBAPP_URL: '',                           // デプロイしたURL。入れるとQRコードにはこのURLを使う（自動で取れない・違うとき用）

  MANABA_ENABLED: true,                     // manaba の課題メール（Gmail）を読むか
  MANABA_QUERY: 'from:manaba subject:公開のお知らせ newer_than:45d',
  MANABA_SUBMIT_QUERY: 'from:manaba subject:提出のお知らせ newer_than:45d',
  MANABA_HIDE_KINDS: [],                    // メール・カレンダーに出さない課題の種類（例: アンケート）

  TIME_ZONE: 'Asia/Tokyo',
  NOTIFY_EMAIL: '',                         // 通知の送り先。空なら自分のアドレス
  DEADLINE_CALENDAR_ID: '',                 // 締切の予定を入れるカレンダー。空ならメインのカレンダー
  DEADLINE_REMINDERS_MIN: [1440, 180],      // 締切の予定の通知（分前）：前日・3時間前
  MORNING_HOUR: 7,                          // まとめメールを送る時刻（時）
  SUMMARY_DAYS: 7,                          // まとめメールに載せる締切の範囲（日）
  JOB_REMINDER_MIN: 60,                     // バイト開始の何分前に知らせるか
  APP_URL: 'https://galaxynagi2006-lang.github.io/schedule-book/'
};

// シート「設定」に並べる項目と説明（上から順に表示する）
const SETTINGS_SHEET = '設定';
const SETTING_NOTES = {
  KEYWORDS: 'タイトルにこの言葉を含む予定をバイトとして扱う（カンマ区切り。「なし」にすると全部の予定）',
  CALENDAR_ID: 'バイト専用のカレンダーがあればそのID（Googleカレンダーの設定 →「カレンダーの統合」）。空ならメイン',
  WRITE_TOKEN: '合言葉（「① 初期設定」で自動で作られる。アプリが読むとき・シフト表を書き込むときに使う）',
  WEBAPP_URL: 'デプロイしたウェブアプリのURL（…/exec）。QRコードが出ないときや、アプリで「Apps Script につながりません」と出るときに入れる（入れるとこのURLを優先）',
  MANABA_ENABLED: 'manaba の課題メールを読むか（TRUE / FALSE）',
  MANABA_HIDE_KINDS: 'まとめメール・バイト前のメール・カレンダーに出さない課題の種類（例: アンケート。カンマ区切り。空なら全部出す）',
  MORNING_HOUR: 'まとめメールを送る時刻（0〜23時）。変えたら「① 初期設定」をもう一度押す',
  SUMMARY_DAYS: 'まとめメールに載せる締切の範囲（日）',
  JOB_REMINDER_MIN: 'バイト開始の何分前に確認メールを送るか',
  DEADLINE_REMINDERS_MIN: '締切の予定の通知（分前、カンマ区切り）。1440 = 前日',
  NOTIFY_EMAIL: '通知の送り先。空なら自分のアドレス',
  DEADLINE_CALENDAR_ID: '締切の予定を入れるカレンダーのID。空ならメイン',
  DAYS_BACK: 'アプリに渡す期間：何日前から',
  DAYS_AHEAD: 'アプリに渡す期間：何日後まで',
  MANABA_QUERY: 'manaba の「公開のお知らせ」を探す Gmail の検索条件',
  MANABA_SUBMIT_QUERY: 'manaba の「提出のお知らせ」を探す Gmail の検索条件'
};

const CONFIG = loadConfig();

/** 初期値に、シート「設定」の値を上書きした設定を作る（シートがない・読めないときは初期値のまま） */
function loadConfig() {
  const config = Object.assign({}, DEFAULT_CONFIG);
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet && spreadsheet.getSheetByName(SETTINGS_SHEET);
    if (!sheet) return config;
    sheet.getDataRange().getValues().slice(1).forEach(row => {
      const key = String(row[0] || '').trim();
      const value = row[1];
      if (!(key in DEFAULT_CONFIG) || value === '' || value === null) return;
      config[key] = convertSetting(DEFAULT_CONFIG[key], value);
    });
  } catch (err) {
    console.warn('設定シートを読めなかったため、初期値を使います', err);
  }
  return config;
}

/** シートの値を、初期値と同じ型（文字・数・TRUE/FALSE・一覧）にそろえる */
function convertSetting(defaultValue, value) {
  if (Array.isArray(defaultValue)) {
    if (String(value).trim() === 'なし') return [];
    const items = String(value).split(/[,、，]/).map(item => item.trim()).filter(Boolean);
    return typeof defaultValue[0] === 'number' ? items.map(Number).filter(n => !isNaN(n)) : items;
  }
  if (typeof defaultValue === 'number') {
    const number = Number(value);
    return isNaN(number) ? defaultValue : number;
  }
  if (typeof defaultValue === 'boolean') return value === true || String(value).trim().toUpperCase() === 'TRUE';
  return String(value).trim();
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEADLINE_TAG = 'smartScheduleDeadline';   // このスクリプトが作った締切の予定につける目印

function getCalendar() {
  return CONFIG.CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
}

/**
 * バイトの予定を取り出す（タイトルの KEYWORDS で判定。このスクリプトが作った締切の予定は除く）
 * 返す形: [{ id, title, start: Date, end: Date }]
 */
function getJobEvents(calendar, from, to) {
  return calendar.getEvents(from, to)
    .filter(event => !event.isAllDayEvent())
    .filter(event => !event.getTag(DEADLINE_TAG))
    .filter(event => CONFIG.KEYWORDS.length === 0 || CONFIG.KEYWORDS.some(word => event.getTitle().includes(word)))
    .map(event => ({
      // 繰り返し予定は同じIDを共有するため、開始時刻と組み合わせて1回ごとに区別する
      id: `${event.getId()}_${event.getStartTime().getTime()}`,
      title: event.getTitle(),
      start: event.getStartTime(),
      end: event.getEndTime()
    }));
}

function doGet(e) {
  // 合言葉が設定されていれば、読み取りにも必要（URLだけが漏れても予定や課題を見られないように）
  const token = e && e.parameter ? e.parameter.token : '';
  if (CONFIG.WRITE_TOKEN && token !== CONFIG.WRITE_TOKEN) {
    return toJson({ error: '合言葉が一致しません（アプリの ⚙️ 設定 → Google連携 の合言葉を確認）', needToken: true });
  }

  const calendar = getCalendar();

  if (!calendar) {
    return toJson({ error: 'カレンダーが見つかりません。CALENDAR_ID を確認してください。' });
  }

  const now = new Date();
  const from = new Date(now.getTime() - CONFIG.DAYS_BACK * DAY);
  const to = new Date(now.getTime() + CONFIG.DAYS_AHEAD * DAY);

  const events = getJobEvents(calendar, from, to).map(job => ({
    id: job.id,
    title: job.title,
    start: job.start.toISOString(),
    end: job.end.toISOString()
  }));

  const result = {
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    events
  };

  if (CONFIG.MANABA_ENABLED) {
    try {
      result.assignments = getManabaAssignments();
      result.submissions = getManabaSubmissions();
    } catch (err) {
      // Gmail の許可がないときなど。カレンダーの予定は返せるようにする
      result.assignmentsError = String(err && err.message || err);
    }
  }

  return toJson(result);
}

/**
 * manaba のお知らせメールから課題の一覧を作る
 * 返す形: [{ id, kind, course, title, deadline: "2026-10-21 00:00:00", url, receivedAt }]
 * 同じ課題のメールが何通かあれば、新しいメールの内容を使う
 */
function getManabaAssignments() {
  const byId = {};
  GmailApp.search(CONFIG.MANABA_QUERY, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      const parsed = parseManabaMail(message.getPlainBody());
      if (!parsed) return;
      const receivedAt = message.getDate().toISOString();
      const previous = byId[parsed.id];
      if (!previous || previous.receivedAt < receivedAt) {
        byId[parsed.id] = Object.assign(parsed, { receivedAt });
      }
    });
  });
  return Object.keys(byId).map(id => byId[id]);
}

/**
 * メール本文の「[コース名] : 〜」「[課題名] : 〜」「[受付終了日時] : 〜」を読み取る
 * （レポート以外の小テストなどでも使えるよう、項目名は少しゆるく探す）
 */
function readManabaFields(body) {
  const fields = {};
  String(body).split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*[\[［]([^\]］]+)[\]］]\s*[:：]\s*(.+?)\s*$/);
    if (match) fields[match[1].trim()] = match[2];
  });
  return fields;
}

function findManabaUrl(body) {
  const match = String(body).match(/https:\/\/[^\s]*manaba\.jp\/ct\/course_[^\s]+/);
  return match ? match[0] : '';
}

function parseManabaMail(body) {
  const fields = readManabaFields(body);

  const titleKey = ['課題名', 'タイトル'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /名$/.test(key) && key !== 'コース名');
  const deadlineKey = ['受付終了日時', '締切日時', '締め切り日時'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /終了|締切|締め切り/.test(key));
  if (!titleKey || !deadlineKey) return null;

  const deadline = fields[deadlineKey].replace(/\//g, '-');
  if (!/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}/.test(deadline)) return null;

  const kindMatch = String(body).match(/--\s*(.+?)情報\s*--/);
  const url = findManabaUrl(body);
  const title = fields[titleKey].replace(/\s+/g, ' ');
  const course = (fields['コース名'] || '').replace(/\s+/g, ' ');

  return {
    // 課題ごとのURL（course_〇〇_report_〇〇）を重複防止の目印にする
    id: url ? `manaba_${url.split('/ct/')[1]}` : `manaba_${course}_${title}_${deadline}`,
    kind: kindMatch ? kindMatch[1].trim() : '課題',
    course,
    title,
    deadline,
    url
  };
}

/**
 * manaba の「提出のお知らせ」メールから、提出した課題の一覧を作る
 * 返す形: [{ id, course, title, submittedAt }]（本文に提出日時がないため、受信日時を提出日時とする）
 */
function getManabaSubmissions() {
  const byId = {};
  GmailApp.search(CONFIG.MANABA_SUBMIT_QUERY, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      const parsed = parseManabaSubmission(message.getPlainBody());
      if (!parsed) return;
      const submittedAt = message.getDate().toISOString();
      const previous = byId[parsed.id];
      if (!previous || previous.submittedAt < submittedAt) {   // 再提出したときは最後の提出
        byId[parsed.id] = Object.assign(parsed, { submittedAt });
      }
    });
  });
  return Object.keys(byId).map(id => byId[id]);
}

function parseManabaSubmission(body) {
  if (!/提出されました/.test(String(body))) return null;
  const fields = readManabaFields(body);
  const url = findManabaUrl(body);
  const titleKey = ['課題名', 'タイトル'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /名$/.test(key) && key !== 'コース名');
  if (!url && !titleKey) return null;
  const title = titleKey ? fields[titleKey].replace(/\s+/g, ' ') : '';
  const course = (fields['コース名'] || '').replace(/\s+/g, ' ');
  return {
    // 公開のお知らせと同じ目印（課題URL）で結び付ける
    id: url ? `manaba_${url.split('/ct/')[1]}` : '',
    course,
    title
  };
}

/**
 * シフトをカレンダーに書き込む
 * 受け取る形: { token, title, shifts: [{ start: ISO文字列, end: ISO文字列 }, ...] }
 * 同じタイトル・同じ開始/終了時刻の予定がすでにあれば作らない（二重登録防止）
 */
function doPost(e) {
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return toJson({ error: '送られたデータを読み取れません' });
  }

  if (!CONFIG.WRITE_TOKEN || request.token !== CONFIG.WRITE_TOKEN) {
    return toJson({ error: '合言葉が一致しません（Apps Script の WRITE_TOKEN を確認）' });
  }

  const calendar = getCalendar();
  if (!calendar) {
    return toJson({ error: 'カレンダーが見つかりません。CALENDAR_ID を確認してください。' });
  }

  const title = String(request.title || 'バイト');
  const shifts = Array.isArray(request.shifts) ? request.shifts : [];
  let created = 0;
  let skipped = 0;

  shifts.forEach(shift => {
    const start = new Date(shift.start);
    const end = new Date(shift.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      skipped++;
      return;
    }
    const exists = calendar.getEvents(start, end).some(event =>
      event.getTitle() === title &&
      event.getStartTime().getTime() === start.getTime() &&
      event.getEndTime().getTime() === end.getTime()
    );
    if (exists) {
      skipped++;
      return;
    }
    calendar.createEvent(title, start, end);
    created++;
  });

  return toJson({ created, skipped });
}

// =====================================================================
// スプレッドシートのメニュー（配布用テンプレートから使う場合）
// =====================================================================

/** スプレッドシートを開いたときに「スケジュール帳」メニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('スケジュール帳')
    .addItem('① 初期設定（最初に1回）', 'initialSetup')
    .addItem('② アプリに登録する情報', 'showConnectionInfo')
    .addSeparator()
    .addItem('まとめメールを試しに送る', 'morningSummary')
    .addItem('今すぐ更新（締切の登録・バイト前の確認）', 'hourlyUpdate')
    .addItem('自動実行（通知）を止める', 'removeTriggers')
    .addToUi();
}

/** 設定シートの用意・合言葉の作成・自動実行の設定をまとめて行う */
function initialSetup() {
  ensureSettingsSheet();
  setupTriggers();
  showConnectionInfo();
}

/** シート「設定」を作り、足りない項目を初期値で追加する（書き換え済みの値はそのまま） */
function ensureSettingsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('この操作は、スプレッドシートのメニューから実行してください');
  const sheet = spreadsheet.getSheetByName(SETTINGS_SHEET) || spreadsheet.insertSheet(SETTINGS_SHEET, 0);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold').setBackground('#eef2ff');
    sheet.setFrozenRows(1);
  }
  const rows = sheet.getDataRange().getValues();
  const rowOf = {};
  rows.forEach((row, i) => { if (row[0]) rowOf[String(row[0]).trim()] = i + 1; });

  Object.keys(SETTING_NOTES).forEach(key => {
    if (rowOf[key]) return;
    sheet.appendRow([key, settingToText(DEFAULT_CONFIG[key]), SETTING_NOTES[key]]);
    rowOf[key] = sheet.getLastRow();
  });

  // 合言葉が空なら、推測されにくいランダムな文字列（32文字）を作る
  const tokenCell = sheet.getRange(rowOf.WRITE_TOKEN, 2);
  if (!String(tokenCell.getValue()).trim()) tokenCell.setValue(Utilities.getUuid().replace(/-/g, ''));

  sheet.getRange(1, 2, sheet.getLastRow(), 1).setNumberFormat('@');   // 値は文字として扱う（0の消失・日付化を防ぐ）
  sheet.autoResizeColumns(1, 2);
  sheet.setColumnWidth(3, 520);
  return sheet;
}

function settingToText(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * ウェブアプリのURL（…/exec）。シート「設定」の WEBAPP_URL があればそれを優先する。
 * 自動で取れるURLは、デプロイが複数ある・アーカイブ済みのデプロイがあるときに、止まったデプロイのものになることがある
 */
function getWebAppUrl(config) {
  if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(config.WEBAPP_URL)) return config.WEBAPP_URL;
  let url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (err) {
    url = '';
  }
  return /^https:\/\/script\.google\.com\/.+\/exec$/.test(url) ? url : '';
}

/**
 * アプリに登録するためのリンク。URLと合言葉を「#connect=」の後ろに入れる
 * （「#」以降はアプリのサーバーに送られず、アプリが読み取ったらすぐにアドレスから消す）
 */
function buildConnectLink(url, token, appUrl) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, t: token }), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return `${appUrl}#connect=${payload}`;
}

/** アプリに登録する情報（スマホ用のQRコード・このパソコン用のリンク・予備のURLと合言葉）を表示する */
function showConnectionInfo() {
  const config = loadConfig();
  const url = getWebAppUrl(config);
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const style = `
    <style>
      body { font-family: sans-serif; font-size: 13px; color: #111827; line-height: 1.6; margin: 0; }
      h3 { font-size: 14px; margin: 12px 0 4px; }
      input { width: 100%; padding: 6px; font-size: 12px; box-sizing: border-box; }
      ol { padding-left: 20px; margin: 4px 0; }
      .qr { display: flex; justify-content: center; margin: 6px 0; min-height: 200px; align-items: center; }
      .qr svg { width: 220px; height: 220px; }
      .btn { display: inline-block; background: #2563eb; color: #fff; padding: 8px 14px; border-radius: 8px; text-decoration: none; font-weight: bold; }
      .center { text-align: center; }
      .warn { color: #92400e; background: #fef3c7; padding: 6px 8px; border-radius: 6px; }
      .note { color: #6b7280; font-size: 12px; }
      details { margin-top: 10px; }
    </style>`;

  if (!url || !config.WRITE_TOKEN) {
    const html = `${style}
      <p class="warn">${!config.WRITE_TOKEN ? '合言葉がまだありません。先に「① 初期設定」を押してください。' : 'まだデプロイされていないようです。'}</p>
      <h3>デプロイの手順（最初の1回だけ）</h3>
      <ol>
        <li>メニュー「拡張機能」→「Apps Script」を開く</li>
        <li>右上の「デプロイ」→「新しいデプロイ」→ 歯車から種類「ウェブアプリ」</li>
        <li>次のユーザーとして実行：<b>自分</b> ／ アクセスできるユーザー：<b>全員</b> →「デプロイ」</li>
        <li>この画面（「② アプリに登録する情報」）をもう一度開く</li>
      </ol>
      <p class="note">デプロイしたのにこの表示のままの場合は、デプロイ後に表示された「ウェブアプリ」のURL（…/exec）を、
      シート「設定」の WEBAPP_URL の「値」に貼ってから、もう一度開いてください。</p>`;
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(420), 'アプリに登録する情報');
    return;
  }

  const link = buildConnectLink(url, config.WRITE_TOKEN, config.APP_URL);
  const html = `${style}
    <h3>📱 スマホで使う場合：カメラでQRコードを読み取る</h3>
    <div class="qr" id="qr">QRコードを作成中…</div>
    <p class="note center">読み取るとアプリが開き、連携が自動で登録されます。<br>
    ホーム画面に追加したアプリで使うときは、アプリの「⚙️ 設定」→「📷 QRコードを読み取る」で読み取ってください</p>
    <h3>💻 このパソコンで使う場合</h3>
    <p class="center"><a class="btn" href="${escape(link)}" target="_blank" rel="noopener">このパソコンのアプリに登録する</a></p>
    <details>
      <summary>QRコードが使えないとき（手で貼り付ける）</summary>
      <p>アプリの「⚙️ 設定」→「Google連携」に、次の2つを貼ってください。</p>
      URL：<input readonly value="${escape(url)}" onclick="this.select()">
      合言葉：<input readonly value="${escape(config.WRITE_TOKEN)}" onclick="this.select()">
    </details>
    <p class="note">アプリで「Apps Script につながりません」と出るときは、上のURLが「デプロイを管理」の
    ウェブアプリのURLと同じか確かめてください。違うときは、正しいURLをシート「設定」の WEBAPP_URL に貼り、
    この画面を開き直して読み取り直します。</p>
    <p class="note">QRコード・URL・合言葉は人に見せないでください（予定と課題を読めてしまいます）。
    自動実行（毎朝${escape(config.MORNING_HOUR)}時のまとめメール・1時間ごとの更新）は設定済みです。</p>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
    <script>
      try {
        // QRコードはこの画面の中で作る（URLや合言葉を外部のサービスに送らない）
        const qr = qrcode(0, 'M');
        qr.addData(${JSON.stringify(link)});
        qr.make();
        document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (err) {
        document.getElementById('qr').textContent = 'QRコードを表示できませんでした。下の方法で登録してください。';
      }
    </script>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(560), 'アプリに登録する情報');
}

// =====================================================================
// アプリを開かなくても届く通知（時間主導型トリガーで自動実行）
// =====================================================================

/** 自動実行を設定する（一度だけ実行すればよい。何度実行しても重複しない） */
function setupTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('hourlyUpdate').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('morningSummary').timeBased().everyDays(1)
    .atHour(CONFIG.MORNING_HOUR).nearMinute(0).inTimezone(CONFIG.TIME_ZONE).create();
  hourlyUpdate();   // すぐに1回動かして、締切の予定を登録しておく
  console.log(`自動実行を設定しました（1時間ごと・毎朝${CONFIG.MORNING_HOUR}時）`);
}

/** 自動実行を止める */
function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['hourlyUpdate', 'morningSummary'].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

/** 1時間ごと：締切の予定を更新し、バイト前の確認メールを送る */
function hourlyUpdate(arg) {
  const now = arg instanceof Date ? arg : new Date();   // トリガーからは別の値が渡るので現在時刻を使う
  const manaba = loadManabaStatus(now);
  syncDeadlineEvents(manaba.all, now);
  remindBeforeJobs(manaba.pending, now);
}

/** 毎朝：今日のバイトと、締切が近い未提出の課題をまとめて送る */
function morningSummary(arg) {
  const now = arg instanceof Date ? arg : new Date();
  const calendar = getCalendar();
  const todayStart = startOfDay(now);
  const jobsToday = getJobEvents(calendar, todayStart, new Date(todayStart.getTime() + DAY));
  const jobsTomorrow = getJobEvents(calendar, new Date(todayStart.getTime() + DAY), new Date(todayStart.getTime() + 2 * DAY));
  const pending = loadManabaStatus(now).pending
    .filter(a => a.deadlineDate.getTime() - now.getTime() <= CONFIG.SUMMARY_DAYS * DAY);

  const message = buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice: '', format: formatDate });
  const advice = getAiAdvice(message.body);
  const finalMessage = advice
    ? buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice, format: formatDate })
    : message;
  sendNotice(finalMessage.subject, finalMessage.body);
}

// ---------- manaba の課題の状況 ----------

/** 課題メールと提出メールから、全課題（提出済みかどうか付き）と締切前の未提出課題を作る */
function loadManabaStatus(now) {
  const assignments = getManabaAssignments().filter(a => !CONFIG.MANABA_HIDE_KINDS.includes(a.kind));
  return computeManabaStatus(assignments, getManabaSubmissions(), now);
}

function computeManabaStatus(assignments, submissions, now) {
  const submittedIds = new Set(submissions.map(s => s.id).filter(Boolean));
  const submittedNames = new Set(submissions.map(s => `${s.course}：${s.title}`));
  const all = assignments
    .map(a => Object.assign({}, a, {
      deadlineDate: parseManabaDate(a.deadline),
      submitted: submittedIds.has(a.id) || submittedNames.has(`${a.course}：${a.title}`)
    }))
    .filter(a => a.deadlineDate);
  const pending = all
    .filter(a => !a.submitted && a.deadlineDate > now)
    .sort((x, y) => x.deadlineDate - y.deadlineDate);
  return { all, pending };
}

/** manaba の日時 "2026-10-21 00:00:00"（日本時間）を Date にする */
function parseManabaDate(text) {
  const m = String(text || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const p = n => String(n).padStart(2, '0');
  return new Date(`${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:00+09:00`);
}

// ---------- ① 締切をカレンダーに登録 ----------

function deadlineEventTitle(a) {
  return `${a.submitted ? '✅ 提出済み' : '📩 締切'}：${a.title}（${a.course}）`;
}

/**
 * 締切前の課題を「📩 締切：〜」の予定として登録し、提出したら「✅ 提出済み：〜」に変えて通知を消す。
 * 予定は締切の30分前〜締切。目印（タグ）で見分けるので、二重に作らない
 */
function syncDeadlineEvents(all, now) {
  const calendar = CONFIG.DEADLINE_CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.DEADLINE_CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
  const existing = {};
  calendar.getEvents(new Date(now.getTime() - 3 * DAY), new Date(now.getTime() + 120 * DAY)).forEach(event => {
    const id = event.getTag(DEADLINE_TAG);
    if (id) existing[id] = event;
  });

  all.forEach(a => {
    const title = deadlineEventTitle(a);
    const start = new Date(a.deadlineDate.getTime() - 30 * MINUTE);
    const event = existing[a.id];
    if (event) {
      if (event.getTitle() !== title) {
        event.setTitle(title);
        if (a.submitted) event.removeAllReminders();   // 提出したら通知しない
      }
      if (event.getEndTime().getTime() !== a.deadlineDate.getTime()) {
        event.setTime(start, a.deadlineDate);   // 締切の延長など
      }
      return;
    }
    if (a.submitted || a.deadlineDate <= now) return;   // 提出済み・締切後の課題は新しく作らない

    const created = calendar.createEvent(title, start, a.deadlineDate, {
      description: `${a.course}\n${a.url || ''}\n（スマートスケジュール帳が自動で登録した予定です）`
    });
    created.setTag(DEADLINE_TAG, a.id);
    created.removeAllReminders();
    CONFIG.DEADLINE_REMINDERS_MIN.forEach(minutes => created.addPopupReminder(minutes));
  });
}

// ---------- ③ バイト前の確認 ----------

/** バイト開始の約 JOB_REMINDER_MIN 分前に、24時間以内に締切の未提出課題があれば知らせる（1回のバイトにつき1通） */
function remindBeforeJobs(pending, now) {
  const props = PropertiesService.getScriptProperties();
  let notified = {};
  try {
    notified = JSON.parse(props.getProperty('notifiedJobs') || '{}');
  } catch (e) {
    notified = {};
  }

  const jobs = getJobEvents(getCalendar(), now, new Date(now.getTime() + 3 * HOUR));
  // 1時間ごとの実行は時刻が少しずれるので、前後に余裕を持たせて探す（同じバイトには1回だけ送る）
  findJobsStartingSoon(jobs, now, CONFIG.JOB_REMINDER_MIN - 40, CONFIG.JOB_REMINDER_MIN + 40).forEach(job => {
    if (notified[job.id]) return;
    const urgent = pending.filter(a => a.deadlineDate.getTime() - now.getTime() <= DAY);
    if (urgent.length > 0) {
      const message = buildJobReminder(job, urgent, now, formatDate);
      sendNotice(message.subject, message.body);
    }
    notified[job.id] = job.start.toISOString();
  });

  // 2日以上前の記録は消す
  Object.keys(notified).forEach(id => {
    if (new Date(notified[id]).getTime() < now.getTime() - 2 * DAY) delete notified[id];
  });
  props.setProperty('notifiedJobs', JSON.stringify(notified));
}

function findJobsStartingSoon(jobs, now, fromMinutes, toMinutes) {
  return jobs.filter(job => {
    const minutesUntil = (job.start.getTime() - now.getTime()) / MINUTE;
    return minutesUntil >= fromMinutes && minutesUntil < toMinutes;
  });
}

// ---------- メールの文面 ----------

function formatDate(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, pattern);
}

function startOfDay(date) {
  return parseManabaDate(`${formatDate(date, 'yyyy-MM-dd')} 00:00`);
}

const WEEKDAY_NAMES = ['', '月', '火', '水', '木', '金', '土', '日'];   // 'u' は 1=月〜7=日

function dayLabel(date, format) {
  return `${format(date, 'M/d')}（${WEEKDAY_NAMES[Number(format(date, 'u'))]}）`;
}

function remainingLabel(deadline, now) {
  const minutes = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / MINUTE));
  if (minutes >= 1440) return `あと${Math.floor(minutes / 1440)}日${Math.floor((minutes % 1440) / 60)}時間`;
  return `あと${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function assignmentLine(a, now, format) {
  const mark = a.deadlineDate.getTime() - now.getTime() <= DAY ? '🚨' : '・';
  return `${mark} ${format(a.deadlineDate, 'M/d HH:mm')} まで（${remainingLabel(a.deadlineDate, now)}）　${a.title}［${a.course}］`;
}

function jobLine(job, format) {
  return `${format(job.start, 'HH:mm')}〜${format(job.end, 'HH:mm')}　${job.title}`;
}

function buildMorningSummary({ now, jobsToday, jobsTomorrow, pending, advice, format }) {
  const lines = [
    `おはようございます。${dayLabel(now, format)}の予定です。`,
    '',
    '■ 今日のバイト',
    ...(jobsToday.length > 0 ? jobsToday.map(job => `  ${jobLine(job, format)}`) : ['  なし']),
    `■ 明日のバイト：${jobsTomorrow.length > 0 ? jobsTomorrow.map(job => jobLine(job, format)).join(' ／ ') : 'なし'}`,
    '',
    `■ 締切が近い課題（${CONFIG.SUMMARY_DAYS}日以内・未提出 ${pending.length}件）`,
    ...(pending.length > 0 ? pending.map(a => `  ${assignmentLine(a, now, format)}`) : ['  なし']),
  ];
  if (advice) lines.push('', `💡 ひとこと：${advice}`);
  lines.push('', `アプリで開く：${CONFIG.APP_URL}`);

  const urgentCount = pending.filter(a => a.deadlineDate.getTime() - now.getTime() <= DAY).length;
  const subject = `【今日の予定】${dayLabel(now, format)} バイト${jobsToday.length > 0 ? 'あり' : 'なし'}・締切${pending.length}件` +
    (urgentCount > 0 ? `（24時間以内 ${urgentCount}件）` : '');
  return { subject, body: lines.join('\n') };
}

function buildJobReminder(job, urgent, now, format) {
  const lines = [
    `${format(job.start, 'HH:mm')}から「${job.title}」です（${format(job.start, 'HH:mm')}〜${format(job.end, 'HH:mm')}）。`,
    'バイトの前に、24時間以内に締切の未提出課題を確認しておきましょう。',
    '',
    ...urgent.map(a => `  ${assignmentLine(a, now, format)}`),
    '',
    `アプリで開く：${CONFIG.APP_URL}`
  ];
  return {
    subject: `【バイト前の確認】${format(job.start, 'HH:mm')}からバイト・締切が近い課題${urgent.length}件`,
    body: lines.join('\n')
  };
}

// ---------- ② AI のひとこと（スクリプト プロパティに GEMINI_API_KEY があるときだけ） ----------

function getAiAdvice(summaryText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return '';
  const prompt = '以下は、授業とアルバイトを両立している大学生の今日の予定と、締切が近い課題です。' +
    '今日いちばん優先してやるべきことを1つに絞り、60文字以内の日本語で1文だけアドバイスしてください。' +
    '前置きや説明は不要です。\n\n' + summaryText;
  try {
    const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      console.warn('AIのひとことを取得できませんでした', response.getResponseCode(), response.getContentText().slice(0, 200));
      return '';
    }
    const data = JSON.parse(response.getContentText());
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    return parts.map(part => part.text || '').join('').trim().replace(/\s+/g, ' ').slice(0, 120);
  } catch (err) {
    console.warn('AIのひとことでエラー', err);
    return '';
  }
}

function sendNotice(subject, body) {
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail(),
    subject,
    body,
    name: 'スマートスケジュール帳'
  });
}

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
