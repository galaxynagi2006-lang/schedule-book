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
 * 【注意】
 *  - URLを知っている人は、条件に合う予定（タイトルと時刻）を見られます。URLは人に教えないこと。
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
  DAYS_AHEAD: 30
};

function doGet() {
  const calendar = CONFIG.CALENDAR_ID
    ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
    : CalendarApp.getDefaultCalendar();

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

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
