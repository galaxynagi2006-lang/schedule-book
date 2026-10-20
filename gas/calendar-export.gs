/**
 * スマートスケジュール帳：Googleカレンダーのバイト予定を書き出す Apps Script
 *
 * 【使い方】
 *  1. https://script.google.com で「新しいプロジェクト」を作り、このコードを貼り付けて保存する
 *  2. 下の CONFIG を自分のカレンダーに合わせて変更する
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選び、
 *       次のユーザーとして実行：自分
 *       アクセスできるユーザー：全員
 *     でデプロイする（初回はカレンダーへのアクセス許可を求められるので「許可」する）
 *  4. 表示された「ウェブアプリのURL」（…/exec で終わるURL）をアプリの
 *     「📅 Googleカレンダー連携」欄に貼り付ける
 *
 * 【シフト表の画像からカレンダーへ書き込む場合】
 *  5. アプリの「📷 シフト表から登録」→ 設定 で「合言葉を作る」を押し、表示された文字列を
 *     下の CONFIG.WRITE_TOKEN に貼り付けて保存する
 *  6. 「デプロイを管理」→ 編集（鉛筆）→ バージョン「新バージョン」→「デプロイ」で更新する
 *     （カレンダーへの書き込み許可を改めて求められたら「許可」する）
 *
 * 【注意】
 *  - URLを知っている人は、条件に合う予定（タイトルと時刻）を見られます。URLは人に教えないこと。
 *  - 書き込みは合言葉が一致したときだけ行います。合言葉が空のままなら書き込みは無効です。
 *  - コードを変更したら「デプロイを管理」→ 編集 → バージョン「新バージョン」で更新する（URLは変わらない）。
 */

const CONFIG = {
  // バイト専用カレンダーがあれば、そのカレンダーID（設定 → カレンダーの統合 に表示）を入れる。
  // 空のままなら、メインのカレンダーを読む。
  CALENDAR_ID: '',

  // タイトルにどれかを含む予定だけを書き出す。
  // バイト専用カレンダーを使う場合は [] にすると、そのカレンダーの予定をすべて書き出す。
  KEYWORDS: ['バイト', 'アルバイト', 'シフト'],

  // 書き出す期間（今日から何日前〜何日後まで）
  DAYS_BACK: 7,
  DAYS_AHEAD: 62,   // 翌月分のシフトもすべて取り込めるように約2か月先まで

  // シフト表から予定を書き込むときの合言葉（アプリの設定と同じ文字列にする）。空なら書き込み無効
  WRITE_TOKEN: ''
};

function getCalendar() {
  return CONFIG.CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();
}

function doGet() {
  const calendar = getCalendar();

  if (!calendar) {
    return toJson({ error: 'カレンダーが見つかりません。CALENDAR_ID を確認してください。' });
  }

  const now = new Date();
  const from = new Date(now.getTime() - CONFIG.DAYS_BACK * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(from, to)
    .filter(event => !event.isAllDayEvent())
    .filter(event => CONFIG.KEYWORDS.length === 0 || CONFIG.KEYWORDS.some(word => event.getTitle().includes(word)))
    .map(event => ({
      // 繰り返し予定は同じIDを共有するため、開始時刻と組み合わせて1回ごとに区別する
      id: `${event.getId()}_${event.getStartTime().getTime()}`,
      title: event.getTitle(),
      start: event.getStartTime().toISOString(),
      end: event.getEndTime().toISOString()
    }));

  return toJson({
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    events
  });
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

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
