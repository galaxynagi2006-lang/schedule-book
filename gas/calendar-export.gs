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
 * 【manaba の課題メール（Gmail）を取り込む場合】
 *  7. このコードに貼り替えたら「デプロイを管理」→ 編集 → バージョン「新バージョン」で更新する
 *     （Gmail を読む許可を求められるので「許可」する。読むのは MANABA_QUERY に合うメールだけ）
 *  8. 不要なら CONFIG.MANABA_ENABLED を false にする
 *
 * 【注意】
 *  - URLを知っている人は、条件に合う予定（タイトルと時刻）を見られます。URLは人に教えないこと。
 *  - manaba の取り込みを有効にすると、URLを知っている人は「課題名・コース名・締切」も見られます。
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
  WRITE_TOKEN: '',

  // manaba の「〇〇公開のお知らせ」メールから課題を読み取ってアプリに渡す
  MANABA_ENABLED: true,
  MANABA_QUERY: 'from:manaba subject:公開のお知らせ newer_than:45d'
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

  const result = {
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    events
  };

  if (CONFIG.MANABA_ENABLED) {
    try {
      result.assignments = getManabaAssignments();
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
function parseManabaMail(body) {
  const fields = {};
  String(body).split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*[\[［]([^\]］]+)[\]］]\s*[:：]\s*(.+?)\s*$/);
    if (match) fields[match[1].trim()] = match[2];
  });

  const titleKey = ['課題名', 'タイトル'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /名$/.test(key) && key !== 'コース名');
  const deadlineKey = ['受付終了日時', '締切日時', '締め切り日時'].find(key => fields[key]) ||
    Object.keys(fields).find(key => /終了|締切|締め切り/.test(key));
  if (!titleKey || !deadlineKey) return null;

  const deadline = fields[deadlineKey].replace(/\//g, '-');
  if (!/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}/.test(deadline)) return null;

  const kindMatch = String(body).match(/--\s*(.+?)情報\s*--/);
  const urlMatch = String(body).match(/https:\/\/[^\s]*manaba\.jp\/ct\/course_[^\s]+/);
  const title = fields[titleKey].replace(/\s+/g, ' ');
  const course = (fields['コース名'] || '').replace(/\s+/g, ' ');

  return {
    // 課題ごとのURL（course_〇〇_report_〇〇）を重複防止の目印にする
    id: urlMatch ? `manaba_${urlMatch[0].split('/ct/')[1]}` : `manaba_${course}_${title}_${deadline}`,
    kind: kindMatch ? kindMatch[1].trim() : '課題',
    course,
    title,
    deadline,
    url: urlMatch ? urlMatch[0] : ''
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

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
