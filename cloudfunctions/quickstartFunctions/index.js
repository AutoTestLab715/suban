const cloud = require("wx-server-sdk");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const {
  listBiaoxun: queryBiaoxunList,
  countBiaoxun: queryBiaoxunCount,
  getBiaoxunDetail: queryBiaoxunDetail,
  fetchBiaoxunAttachment: queryFetchBiaoxunAttachment,
  resolveBiaoxunHallImages: queryResolveBiaoxunHallImages,
  cleanupBiaoxunAttachment: queryCleanupBiaoxunAttachment,
  formatBiaoxunError,
} = require("./biaoxun");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const FORM_COLLECTION = "form_submissions";
const USER_COLLECTION = "users";
const TEMPLATE_COLLECTION = "form_templates";
const AUDIT_COLLECTION = "form_audit_logs";
const CAPTCHA_COLLECTION = "form_captcha_tokens";
const BACKUP_COLLECTION = "form_backups";
const WEB_LOGIN_COLLECTION = "web_login_sessions";
const NOTIFY_TEMPLATE_COLLECTION = "notify_templates";
const EMAIL_CONFIG_COLLECTION = "email_configs";

const {
  DEFAULT_TEMPLATE,
  validateAnswers,
  getSummaryFromItem,
  buildCSV,
  buildExcel,
  buildBackupExcel,
  formatSubmissionStatus,
  filterSubmissions,
  checkFormSchedule,
  verifyFormPassword,
  hashFormPassword,
  sanitizeTemplate,
  stableStringify,
  checkPhoneWhitelist,
  parsePhoneWhitelist,
  extractSubmitPhone,
  checkShareAccess,
  checkGroupAccess,
  checkOpenidWhitelist,
  buildFieldStats,
  detectAnomalies,
  checkFriendAccess,
  canUserEditSubmission,
  formatSubscribeFieldValue,
  parseTemplateFields,
  buildSubscribeMessageDataAuto,
  extractNotifyValuesFromAnswers,
} = require("./formCore");

const ADMIN_NOTIFY_TEMPLATE_TITLE = "留言通知";

let subscribeTemplateCache = null;
let subscribeTemplateCacheAt = 0;
let subscribeTemplateErrorAt = 0;

const getSubscribeTemplateList = async (options = {}) => {
  const { optional = false } = options;
  if (subscribeTemplateCache && Date.now() - subscribeTemplateCacheAt < 10 * 60 * 1000) {
    return subscribeTemplateCache;
  }
  // 短时间内连续失败时避免打爆微信接口
  if (optional && subscribeTemplateErrorAt && Date.now() - subscribeTemplateErrorAt < 60 * 1000) {
    return subscribeTemplateCache || [];
  }
  try {
    const res = await cloud.openapi.subscribeMessage.getTemplateList({});
    subscribeTemplateCache = res.data || [];
    subscribeTemplateCacheAt = Date.now();
    subscribeTemplateErrorAt = 0;
    return subscribeTemplateCache;
  } catch (e) {
    subscribeTemplateErrorAt = Date.now();
    if (optional) {
      console.error("getSubscribeTemplateList failed", e && (e.errMsg || e.message || e));
      return subscribeTemplateCache || [];
    }
    throw e;
  }
};

const resolveSubscribeTemplate = async (preferredId = "") => {
  const list = await getSubscribeTemplateList({ optional: true });
  if (!list.length) return null;
  if (preferredId) {
    const matched = list.find((item) => item.priTmplId === preferredId);
    if (matched) return matched;
  }
  const messageTemplate = list.find(
    (item) => item.title === ADMIN_NOTIFY_TEMPLATE_TITLE || String(item.title || "").includes("留言通知")
  );
  if (messageTemplate) return messageTemplate;
  return list.find((item) => item.type === 3) || list[0];
};

const findPlatformTemplate = async (priTmplId) => {
  if (!priTmplId) return null;
  const list = await getSubscribeTemplateList();
  return list.find((item) => item.priTmplId === priTmplId) || null;
};

const getNotifyConfigById = async (configId) => {
  if (!configId) return null;
  try {
    await ensureCollection(NOTIFY_TEMPLATE_COLLECTION);
    const doc = await db.collection(NOTIFY_TEMPLATE_COLLECTION).doc(configId).get();
    return doc.data || null;
  } catch (e) {
    return null;
  }
};

const resolvePlatformTemplateForNotify = async (settings = {}) => {
  if (settings.notifyConfigId) {
    const config = await getNotifyConfigById(settings.notifyConfigId);
    if (config && config.enabled !== false && config.platformTemplateId) {
      const platform = await findPlatformTemplate(config.platformTemplateId);
      if (platform) {
        return { ...platform, configId: config._id, configName: config.name };
      }
      if (config.platformTemplateContent) {
        return {
          priTmplId: config.platformTemplateId,
          title: config.platformTemplateTitle || config.name,
          content: config.platformTemplateContent,
          configId: config._id,
          configName: config.name,
        };
      }
    }
  }
  return resolveSubscribeTemplate(settings.notifyTemplateId);
};

const userSubscribedToTemplate = (user, priTmplId) => {
  if (!user || !priTmplId) return false;
  const ids = user.notifySubscribedIds || [];
  if (ids.includes(priTmplId)) return true;
  return !!user.notifySubscribed && user.notifyTemplateId === priTmplId;
};

const https = require("https");
const http = require("http");

const postJsonWebhook = (url, body) =>
  new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const data = JSON.stringify(body);
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
          timeout: 8000,
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => {
            chunks += c;
          });
          res.on("end", () => resolve(chunks));
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("webhook timeout"));
      });
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });

const sendSmsWebhook = async (settings = {}, payload = {}) => {
  if (!settings.smsEnabled) return;
  const phones = collectSmsPhones(settings, payload.phone);
  if (!phones.length) return;

  const content =
    payload.content ||
    `【${payload.templateTitle || "表单通知"}】${payload.name || "用户"}提交了表单，请及时处理。`;

  const tasks = [];
  if (settings.smsWebhookUrl) {
    tasks.push(
      ...phones.map((phone) =>
        postJsonWebhook(settings.smsWebhookUrl, {
          phone,
          content: String(content).slice(0, 500),
          secret: settings.smsSecret || "",
          event: payload.event || "submit",
        }).catch(() => null)
      )
    );
  }
  if (settings.tencentSmsEnabled && settings.tencentSecretId && settings.tencentSecretKey) {
    tasks.push(sendTencentSms(settings, phones, content, payload.templateParams || []).catch(() => null));
  }
  if (tasks.length) await Promise.all(tasks);
};

const collectSmsPhones = (settings, extraPhone) => {
  const phones = [];
  if (extraPhone) phones.push(String(extraPhone).trim());
  if (Array.isArray(settings.smsNotifyPhones)) {
    settings.smsNotifyPhones.forEach((p) => {
      const s = String(p).trim();
      if (s) phones.push(s);
    });
  } else if (typeof settings.smsNotifyPhones === "string") {
    settings.smsNotifyPhones
      .split(/[\n,，;；\s]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((p) => phones.push(p));
  }
  return [...new Set(phones.filter(Boolean))];
};

const sendTencentSms = async (settings, phones, content, templateParams = []) => {
  let SmsClient;
  try {
    SmsClient = require("tencentcloud-sdk-nodejs").sms.v20210111.Client;
  } catch (e) {
    return;
  }

  const client = new SmsClient({
    credential: {
      secretId: settings.tencentSecretId,
      secretKey: settings.tencentSecretKey,
    },
    region: settings.tencentSmsRegion || "ap-guangzhou",
    profile: { httpProfile: { endpoint: "sms.tencentcloudapi.com" } },
  });

  const phoneSet = phones.map((p) => {
    const num = String(p).replace(/\D/g, "");
    return num.startsWith("86") ? `+${num}` : `+86${num}`;
  });

  await client.SendSms({
    PhoneNumberSet: phoneSet,
    SmsSdkAppId: String(settings.tencentSmsAppId || ""),
    SignName: String(settings.tencentSmsSign || ""),
    TemplateId: String(settings.tencentSmsTemplateId || ""),
    TemplateParamSet: templateParams.length
      ? templateParams.map(String)
      : [String(content).slice(0, 20)],
  });
};

const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

const createCollection = async () => {
  try {
    await db.createCollection("sales");
    await db.collection("sales").add({
      data: { region: "华东", city: "上海", sales: 11 },
    });
    await db.collection("sales").add({
      data: { region: "华东", city: "南京", sales: 11 },
    });
    await db.collection("sales").add({
      data: { region: "华南", city: "广州", sales: 22 },
    });
    await db.collection("sales").add({
      data: { region: "华南", city: "深圳", sales: 22 },
    });
    return { success: true };
  } catch (e) {
    return { success: true, data: "create collection success" };
  }
};

const selectRecord = async () => {
  return await db.collection("sales").get();
};

const updateRecord = async (event) => {
  try {
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({ _id: event.data[i]._id })
        .update({
          data: { sales: event.data[i].sales },
        });
    }
    return { success: true, data: event.data };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return { success: true, data: event.data };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({ _id: event.data._id })
      .remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合已存在
  }
};

const addDocument = async (collection, data) => {
  try {
    return await db.collection(collection).add({ data });
  } catch (e) {
    const errStr = formatCloudError(e);
    if (errStr.includes("not exist") || errStr.includes("502005") || errStr.includes("Db or Table not exist")) {
      await db.createCollection(collection);
      return await db.collection(collection).add({ data });
    }
    throw e;
  }
};

const getWxOpenId = () => {
  const ctx = cloud.getWXContext();
  return ctx.OPENID || ctx.WX_OPENID || "";
};

const formatCloudError = (e) => {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || e.errMsg || e.errCode || JSON.stringify(e);
};

const formatEmailError = (e) => {
  const raw = formatCloudError(e);
  if (/535|Login fail|authentication failed|Invalid login/i.test(raw)) {
    return "邮箱登录失败（535）。请确认：1）已在 QQ 邮箱开启 SMTP 服务；2）密码栏填写的是授权码，不是 QQ 登录密码；3）发件账号与授权码对应同一邮箱。详见 https://help.mail.qq.com/detail/108/1023";
  }
  if (/EAUTH|AUTH/i.test(raw)) {
    return "邮箱认证失败，请检查发件账号和授权码是否正确。";
  }
  return raw || "邮件发送失败";
};

const sanitizeUser = (user) => {
  if (!user) return null;
  const role = user.role === "admin" ? "admin" : "user";
  const result = {
    _id: user._id,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl || "",
    phone: user.phone || "",
    email: user.email || "",
    role,
    notifySubscribed: !!user.notifySubscribed,
  };
  if (role === "admin") {
    result.adminRole = user.adminRole || "owner";
  }
  return result;
};

const userIsAdmin = (user) => !!(user && user.role === "admin");

const getUserByOpenid = async (openid) => {
  if (!openid) return null;
  await ensureCollection(USER_COLLECTION);
  const _ = db.command;
  const result = await db
    .collection(USER_COLLECTION)
    .where(
      _.or([{ openid }, { _openid: openid }])
    )
    .limit(1)
    .get();
  return result.data[0] || null;
};

const isAdmin = async (openid) => {
  const user = await getUserByOpenid(openid);
  return userIsAdmin(user);
};

const requireUser = async () => {
  const openid = getWxOpenId();
  const user = await getUserByOpenid(openid);
  if (!user) {
    return { ok: false, result: { success: false, errMsg: "请先注册登录" } };
  }
  return { ok: true, openid, user };
};

/** 表单等记录归属：openid 或手机号任一匹配 */
const buildSubmissionOwnerWhere = (openid, phone = "") => {
  const _ = db.command;
  const parts = [{ openid }, { _openid: openid }];
  const safePhone = String(phone || "").trim();
  if (safePhone) {
    parts.push({ phone: safePhone });
    parts.push({ "answers.phone": safePhone });
  }
  return _.or(parts);
};

const ownsSubmission = (item, auth) => {
  if (!item || !auth?.openid) return false;
  const oid = item.openid || item._openid;
  if (oid && oid === auth.openid) return true;
  const phone = String(auth.user?.phone || "").trim();
  if (!phone) return false;
  if (String(item.phone || "").trim() === phone) return true;
  if (String(item.answers?.phone || "").trim() === phone) return true;
  return false;
};

/** 登录换绑时：把历史表单记录绑定到手机号并同步当前 openid */
const bindSubmissionsToIdentity = async ({ phone, openid, previousOpenids = [] }) => {
  const safePhone = String(phone || "").trim();
  if (!safePhone || !openid) return;

  await ensureCollection(FORM_COLLECTION);
  const _ = db.command;
  const seen = new Set();
  const openidList = [...new Set([openid, ...previousOpenids].filter(Boolean))];

  const patchDocs = async (whereClause) => {
    for (let i = 0; i < 30; i++) {
      const res = await db.collection(FORM_COLLECTION).where(whereClause).limit(20).get();
      const rows = (res.data || []).filter((row) => row._id && !seen.has(row._id));
      if (!rows.length) break;
      await Promise.all(
        rows.map((row) => {
          seen.add(row._id);
          return db.collection(FORM_COLLECTION).doc(row._id).update({
            data: { phone: safePhone, openid },
          });
        })
      );
      if (rows.length < 20) break;
    }
  };

  for (const oid of openidList) {
    await patchDocs(_.or([{ openid: oid }, { _openid: oid }]));
  }
  await patchDocs({ phone: safePhone });
  await patchDocs({ "answers.phone": safePhone });
};

const ADMIN_PERMISSIONS = {
  owner: ["read", "edit", "delete", "export", "config", "checkin", "team"],
  editor: ["read", "edit", "export", "checkin"],
  viewer: ["read"],
  exporter: ["read", "export"],
};

const getAdminRole = (user) => {
  if (!user || user.role !== "admin") return null;
  const role = user.adminRole || "owner";
  return ADMIN_PERMISSIONS[role] ? role : "viewer";
};

const { AsyncLocalStorage } = require("async_hooks");
const requestContext = new AsyncLocalStorage();

const getWebAdminSecret = () => process.env.WEB_ADMIN_TOKEN || "";

const allowBiaoxunRequest = () => {
  const meta = requestContext.getStore() || {};
  return !meta.isHttp;
};

const listBiaoxun = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    return await queryBiaoxunList(event.data || {});
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const countBiaoxun = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    return await queryBiaoxunCount(event.data || {});
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const getBiaoxunDetail = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    return await queryBiaoxunDetail(event.data || {});
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const fetchBiaoxunAttachment = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    // ponytail: 附件校验走本地 MySQL 详情；勿再挂失效 HTTP detailLoader
    return await queryFetchBiaoxunAttachment(event.data || {}, { cloud });
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const resolveBiaoxunHallImages = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    return await queryResolveBiaoxunHallImages(event.data || {}, { cloud });
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const cleanupBiaoxunAttachment = async (event) => {
  if (!allowBiaoxunRequest()) return { success: false, errMsg: "该接口仅供小程序使用" };
  try {
    return await queryCleanupBiaoxunAttachment(event.data || {}, { cloud });
  } catch (error) {
    return { success: false, errMsg: formatBiaoxunError(error) };
  }
};

const genRandomToken = (len = 32) => {
  const crypto = require("crypto");
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
};

const resolveWebTokenAuth = async (token) => {
  if (!token) return null;
  const secret = getWebAdminSecret();
  if (secret && token === secret) {
    return {
      openid: "web-admin",
      user: { role: "admin", adminRole: "owner", nickName: "网页管理员" },
      adminRole: "owner",
    };
  }
  await ensureCollection(WEB_LOGIN_COLLECTION);
  const result = await db
    .collection(WEB_LOGIN_COLLECTION)
    .where({ token, status: "confirmed" })
    .limit(1)
    .get();
  const session = result.data[0];
  if (!session) return null;
  const tokenExpireAt = session.tokenExpireAt ? new Date(session.tokenExpireAt).getTime() : 0;
  if (!tokenExpireAt || tokenExpireAt < Date.now()) return null;
  const user = await getUserByOpenid(session.openid);
  if (!userIsAdmin(user)) return null;
  const adminRole = getAdminRole(user) || "owner";
  return { openid: session.openid, user, adminRole };
};

const verifyWebAdminToken = (token) => {
  const secret = getWebAdminSecret();
  return !!(secret && token && token === secret);
};

const requireAdmin = async (perm = "read", webToken = "") => {
  const token = webToken || requestContext.getStore()?.webToken || "";
  const webAuth = await resolveWebTokenAuth(token);
  if (webAuth) {
    if (!ADMIN_PERMISSIONS[webAuth.adminRole]?.includes(perm)) {
      return { ok: false, result: { success: false, errMsg: "当前账号无此操作权限" } };
    }
    return { ok: true, openid: webAuth.openid, user: webAuth.user, adminRole: webAuth.adminRole };
  }

  const openid = getWxOpenId();
  const user = await getUserByOpenid(openid);
  if (!(await isAdmin(openid))) {
    return { ok: false, result: { success: false, errMsg: "无管理员权限" } };
  }
  const adminRole = getAdminRole(user) || "owner";
  if (!ADMIN_PERMISSIONS[adminRole]?.includes(perm)) {
    return { ok: false, result: { success: false, errMsg: "当前账号无此操作权限" } };
  }
  return { ok: true, openid, user, adminRole };
};

const webAdminLogin = async (event) => {
  try {
    const { password } = event.data || {};
    const secret = getWebAdminSecret();
    if (!secret) {
      return {
        success: false,
        errMsg: "未配置网页后台密钥，请在云函数环境变量中设置 WEB_ADMIN_TOKEN",
      };
    }
    if (!password || password !== secret) {
      return { success: false, errMsg: "访问密钥错误" };
    }
    return { success: true, token: secret };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "登录失败" };
  }
};

const genShortCode = () => String(Math.floor(100000 + Math.random() * 900000));

const buildWebLoginQr = async (sessionId, expireAtSec) => {
  const page = "pages/admin/weblogin/index";
  const query = `session=${sessionId}`;
  const path = `${page}?${query}`;

  try {
    const resp = await cloud.openapi.wxacode.get({ path });
    if (resp?.buffer?.length) {
      return { qrDataUrl: `data:image/png;base64,${resp.buffer.toString("base64")}` };
    }
  } catch (e) {
    console.warn("wxacode.get failed:", e.message || e);
  }

  try {
    const resp = await cloud.openapi.wxacode.getUnlimited({
      scene: sessionId,
      page,
      check_path: false,
      width: 280,
    });
    if (resp?.buffer?.length) {
      return { qrDataUrl: `data:image/png;base64,${resp.buffer.toString("base64")}` };
    }
  } catch (e) {
    console.warn("wxacode.getUnlimited failed:", e.message || e);
  }

  try {
    const scheme = await cloud.openapi.urlscheme.generate({
      jump_wxa: { path: page, query },
      is_expire: true,
      expire_time: expireAtSec,
    });
    if (scheme?.openlink) {
      return { qrContent: scheme.openlink };
    }
  } catch (e) {
    console.warn("urlscheme.generate failed:", e.message || e);
  }

  return null;
};

const createWebLoginSession = async () => {
  try {
    await ensureCollection(WEB_LOGIN_COLLECTION);
    const sessionId = genRandomToken(24);
    const shortCode = genShortCode();
    const expireAt = Date.now() + 5 * 60 * 1000;
    const expireAtSec = Math.floor(expireAt / 1000);

    await addDocument(WEB_LOGIN_COLLECTION, {
      sessionId,
      shortCode,
      status: "pending",
      openid: "",
      token: "",
      createTime: db.serverDate(),
      expireAt: new Date(expireAt),
    });

    const qr = await buildWebLoginQr(sessionId, expireAtSec);

    return {
      success: true,
      sessionId,
      shortCode,
      qrDataUrl: qr?.qrDataUrl || "",
      qrContent: qr?.qrContent || "",
      qrUrl: qr?.qrDataUrl || "",
      expireIn: 300,
      qrError: qr ? "" : "小程序码接口暂不可用，请使用下方验证码在小程序中确认登录",
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "创建登录会话失败" };
  }
};

const pollWebLoginSession = async (event) => {
  try {
    const { sessionId } = event.data || {};
    if (!sessionId) return { success: false, errMsg: "缺少 sessionId" };
    await ensureCollection(WEB_LOGIN_COLLECTION);
    const result = await db.collection(WEB_LOGIN_COLLECTION).where({ sessionId }).limit(1).get();
    const session = result.data[0];
    if (!session) return { success: false, errMsg: "登录会话不存在" };
    const expireAt = session.expireAt ? new Date(session.expireAt).getTime() : 0;
    if (session.status === "pending" && expireAt && expireAt < Date.now()) {
      return { success: true, status: "expired" };
    }
    if (session.status !== "confirmed" || !session.token) {
      return { success: true, status: session.status || "pending" };
    }
    const tokenExpire = session.tokenExpireAt ? new Date(session.tokenExpireAt).getTime() : 0;
    if (tokenExpire && tokenExpire < Date.now()) {
      return { success: true, status: "expired" };
    }
    const user = await getUserByOpenid(session.openid);
    return {
      success: true,
      status: "confirmed",
      token: session.token,
      user: sanitizeUser(user),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "查询失败" };
  }
};

const confirmWebLoginSession = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    const { sessionId, shortCode } = event.data || {};
    if (!sessionId && !shortCode) {
      return { success: false, errMsg: "缺少 sessionId 或验证码" };
    }
    await ensureCollection(WEB_LOGIN_COLLECTION);
    let result;
    if (sessionId) {
      result = await db.collection(WEB_LOGIN_COLLECTION).where({ sessionId }).limit(1).get();
    } else {
      result = await db
        .collection(WEB_LOGIN_COLLECTION)
        .where({ shortCode: String(shortCode).trim(), status: "pending" })
        .limit(1)
        .get();
    }
    const session = result.data[0];
    if (!session) return { success: false, errMsg: "登录会话不存在或已过期" };
    const expireAt = session.expireAt ? new Date(session.expireAt).getTime() : 0;
    if (session.status !== "pending" || (expireAt && expireAt < Date.now())) {
      return { success: false, errMsg: "登录会话已过期，请刷新网页二维码" };
    }

    const token = genRandomToken(48);
    const tokenExpireAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection(WEB_LOGIN_COLLECTION).doc(session._id).update({
      data: {
        status: "confirmed",
        openid: auth.openid,
        token,
        tokenExpireAt,
        confirmTime: db.serverDate(),
        adminRole: auth.adminRole || "owner",
      },
    });

    return {
      success: true,
      user: sanitizeUser(auth.user),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "确认失败" };
  }
};

const listPendingWebLoginSessions = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(WEB_LOGIN_COLLECTION);
    const result = await db
      .collection(WEB_LOGIN_COLLECTION)
      .where({ status: "pending" })
      .orderBy("createTime", "desc")
      .limit(10)
      .get();
    const now = Date.now();
    const list = (result.data || [])
      .filter((s) => {
        const exp = s.expireAt ? new Date(s.expireAt).getTime() : 0;
        return !exp || exp > now;
      })
      .map((s) => ({
        sessionId: s.sessionId,
        shortCode: s.shortCode || "",
        createTime: s.createTime,
      }));
    return { success: true, list };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const checkUser = async () => {
  try {
    const openid = getWxOpenId();
    if (!openid) {
      return { success: true, registered: false, openid: "" };
    }
    const user = await getUserByOpenid(openid);
    if (!user) {
      return { success: true, registered: false, openid };
    }
    return {
      success: true,
      registered: true,
      user: sanitizeUser(user),
      isAdmin: userIsAdmin(user),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "检查失败" };
  }
};

const loginUser = async () => {
  try {
    const openid = getWxOpenId();
    if (!openid) {
      return { success: false, errMsg: "无法获取微信身份，请重新打开小程序" };
    }
    const user = await getUserByOpenid(openid);
    if (!user) {
      return { success: false, errMsg: "用户未注册", registered: false };
    }

    await db.collection(USER_COLLECTION).doc(user._id).update({
      data: { lastLoginTime: db.serverDate() },
    });

    return {
      success: true,
      registered: true,
      user: sanitizeUser(user),
      isAdmin: userIsAdmin(user),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "登录失败" };
  }
};

const phoneLogin = async (event) => {
  try {
    const { code } = event.data || {};
    if (!code) {
      return { success: false, errMsg: "缺少手机号授权码" };
    }

    const openid = getWxOpenId();
    if (!openid) {
      return { success: false, errMsg: "无法获取微信身份，请重新打开小程序" };
    }

    let phoneNumber = "";
    try {
      const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code });
      phoneNumber =
        phoneRes.phoneInfo?.phoneNumber ||
        phoneRes.phone_info?.phoneNumber ||
        phoneRes.phoneInfo?.purePhoneNumber ||
        "";
    } catch (e) {
      return { success: false, errMsg: formatCloudError(e) || "获取手机号失败，请重试" };
    }

    if (!phoneNumber) {
      return { success: false, errMsg: "未能获取手机号" };
    }

    await ensureCollection(USER_COLLECTION);
    const existingByOpenid = await getUserByOpenid(openid);
    const phoneOwnerRes = await db
      .collection(USER_COLLECTION)
      .where({ phone: phoneNumber })
      .limit(10)
      .get();
    const phoneOwners = phoneOwnerRes.data || [];
    // 优先命中当前微信已有账号；否则取第一条手机号账号
    const phoneUser =
      phoneOwners.find((u) => u.openid === openid || u._openid === openid) ||
      phoneOwners[0] ||
      null;

    let user;
    let isNew = false;

    if (phoneUser) {
      const previousOpenids = [
        phoneUser.openid,
        phoneUser._openid,
        existingByOpenid?.openid,
        existingByOpenid?._openid,
      ].filter((oid) => oid && oid !== openid);

      // 手机号可换绑微信：登录原手机号账号，并更新为当前 openid
      await db.collection(USER_COLLECTION).doc(phoneUser._id).update({
      data: {
          openid,
          phone: phoneNumber,
          lastLoginTime: db.serverDate(),
      },
    });

      // 其他同号脏数据清除手机号，避免多账号占用同一号码
      await Promise.all(
        phoneOwners
          .filter((u) => u._id !== phoneUser._id)
          .map((u) =>
            db.collection(USER_COLLECTION).doc(u._id).update({
              data: { phone: "" },
            })
          )
      );

      // 当前微信若另有独立账号，解除其 openid，避免后续按微信命中到空壳账号
      if (existingByOpenid && existingByOpenid._id !== phoneUser._id) {
        await db.collection(USER_COLLECTION).doc(existingByOpenid._id).update({
          data: { openid: "" },
        });
      }

      // 历史表单等记录绑定手机号，并同步到当前微信身份
      await bindSubmissionsToIdentity({
        phone: phoneNumber,
        openid,
        previousOpenids,
      });

      user = { ...phoneUser, openid, phone: phoneNumber };
    } else if (existingByOpenid) {
      await db.collection(USER_COLLECTION).doc(existingByOpenid._id).update({
      data: {
          phone: phoneNumber,
          lastLoginTime: db.serverDate(),
      },
    });
      await bindSubmissionsToIdentity({
        phone: phoneNumber,
        openid,
        previousOpenids: [existingByOpenid.openid, existingByOpenid._openid],
      });
      user = { ...existingByOpenid, phone: phoneNumber };
    } else {
      isNew = true;
      const nickName = `用户${phoneNumber.slice(-4)}`;
      const addResult = await addDocument(USER_COLLECTION, {
        openid,
        nickName,
        avatarUrl: "",
        phone: phoneNumber,
        email: "",
        role: "user",
        createTime: db.serverDate(),
        lastLoginTime: db.serverDate(),
      });
      user = {
        _id: addResult._id,
        nickName,
        avatarUrl: "",
        phone: phoneNumber,
        email: "",
        role: "user",
      };
    }

    return {
      success: true,
      registered: true,
      isNew,
      user: sanitizeUser(user),
      isAdmin: userIsAdmin(user),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "登录失败" };
  }
};

const registerUser = async (event) => {
  try {
    const { nickName, avatarUrl } = event.data || {};
    if (!nickName || !nickName.trim()) {
      return { success: false, errMsg: "请填写昵称" };
    }

    const openid = getWxOpenId();
    if (!openid) {
      return { success: false, errMsg: "无法获取微信身份，请重新打开小程序" };
    }

    await ensureCollection(USER_COLLECTION);
    const existing = await getUserByOpenid(openid);
    const trimmedName = nickName.trim();
    const savedAvatar = avatarUrl || "";

    if (existing) {
      await db.collection(USER_COLLECTION).doc(existing._id).update({
        data: {
          nickName: trimmedName,
          avatarUrl: savedAvatar || existing.avatarUrl || "",
          lastLoginTime: db.serverDate(),
        },
      });
      const user = {
        ...existing,
        nickName: trimmedName,
        avatarUrl: savedAvatar || existing.avatarUrl || "",
      };
    return {
      success: true,
        isNew: false,
        user: sanitizeUser(user),
        isAdmin: userIsAdmin(user),
      };
    }

    const addResult = await addDocument(USER_COLLECTION, {
      openid,
      nickName: trimmedName,
      avatarUrl: savedAvatar,
      phone: "",
      email: "",
      role: "user",
      createTime: db.serverDate(),
      lastLoginTime: db.serverDate(),
    });

    return {
      success: true,
      isNew: true,
      user: sanitizeUser({
        _id: addResult._id,
        nickName: trimmedName,
        avatarUrl: savedAvatar,
        phone: "",
        email: "",
        role: "user",
      }),
      isAdmin: false,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "注册失败" };
  }
};

const getUserProfile = async () => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  return {
    success: true,
    user: sanitizeUser(auth.user),
  };
};

const updateUserProfile = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { nickName, avatarUrl, email } = event.data || {};
    if (!nickName || !nickName.trim()) {
      return { success: false, errMsg: "请填写昵称" };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, errMsg: "邮箱格式不正确" };
    }

    // 手机号仅允许通过微信手机号授权（phoneLogin）更新，防止白名单冒用
    const updateData = {
      nickName: nickName.trim(),
      avatarUrl: avatarUrl || auth.user.avatarUrl || "",
      email: email ? email.trim() : "",
      updateTime: db.serverDate(),
    };

    await db.collection(USER_COLLECTION).doc(auth.user._id).update({
      data: updateData,
    });

    return {
      success: true,
      user: sanitizeUser({ ...auth.user, ...updateData }),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const checkAdmin = async () => {
  try {
    const openid = getWxOpenId();
    const admin = await isAdmin(openid);
    const user = await getUserByOpenid(openid);
    const adminRole = admin ? getAdminRole(user) || "owner" : "";
    return {
      success: true,
      isAdmin: admin,
      openid,
      adminRole,
      permissions: admin ? ADMIN_PERMISSIONS[adminRole] || [] : [],
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "检查失败" };
  }
};

const getAdminTeam = async () => {
  const auth = await requireAdmin("team");
  if (!auth.ok) return auth.result;

  try {
    const result = await db.collection(USER_COLLECTION).where({ role: "admin" }).limit(50).get();
    const list = (result.data || []).map((u) => ({
      _id: u._id,
      nickName: u.nickName || "管理员",
      avatarUrl: u.avatarUrl || "",
      adminRole: u.adminRole || "owner",
      openid: u.openid || u._openid || "",
    }));
    return { success: true, list, myRole: auth.adminRole };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const updateAdminRole = async (event) => {
  const auth = await requireAdmin("team");
  if (!auth.ok) return auth.result;

  try {
    const { userId, adminRole } = event.data || {};
    if (!userId) return { success: false, errMsg: "缺少用户 ID" };
    if (!ADMIN_PERMISSIONS[adminRole]) {
      return { success: false, errMsg: "角色无效" };
    }

    const target = await db.collection(USER_COLLECTION).doc(userId).get();
    if (!target.data || target.data.role !== "admin") {
      return { success: false, errMsg: "目标用户不是管理员" };
    }

    if (auth.adminRole !== "owner") {
      return { success: false, errMsg: "仅超级管理员可修改角色" };
    }

    await db.collection(USER_COLLECTION).doc(userId).update({
      data: { adminRole, updateTime: db.serverDate() },
    });

    await logAdminAction(auth, "update_admin_role", userId, { adminRole });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "更新失败" };
  }
};

const ensureDefaultTemplate = async () => {
  await ensureCollection(TEMPLATE_COLLECTION);
  const existing = await db
    .collection(TEMPLATE_COLLECTION)
    .where({ isDefault: true })
    .limit(1)
    .get();
  if (existing.data.length > 0) return existing.data[0];

  const addResult = await addDocument(TEMPLATE_COLLECTION, {
    ...DEFAULT_TEMPLATE,
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
  });
  const created = await db.collection(TEMPLATE_COLLECTION).doc(addResult._id).get();
  return created.data;
};

const getTemplateById = async (templateId, { requireEnabled = false } = {}) => {
  await ensureCollection(TEMPLATE_COLLECTION);
  let template;
  if (templateId) {
    try {
      const doc = await db.collection(TEMPLATE_COLLECTION).doc(templateId).get();
      template = doc.data;
    } catch (e) {
      template = null;
    }
    if (!template) {
      const err = new Error("表单模板不存在");
      err.code = "TEMPLATE_NOT_FOUND";
      throw err;
    }
  } else {
    template = await ensureDefaultTemplate();
  }

  if (requireEnabled && template.enabled === false) {
    const err = new Error("表单已停用");
    err.code = "TEMPLATE_DISABLED";
    throw err;
  }
  return template;
};

const getActiveTemplate = async (templateId) =>
  getTemplateById(templateId, { requireEnabled: true });

const logAudit = async (entry) => {
  try {
    await ensureCollection(AUDIT_COLLECTION);
    await db.collection(AUDIT_COLLECTION).add({
      data: {
        ...entry,
        createTime: db.serverDate(),
      },
    });
  } catch (e) {
    /* ignore audit failures */
  }
};

const logAdminAction = async (auth, action, targetId = "", detail = {}) => {
  if (!auth?.openid) return;
  await logAudit({
    action,
    targetId,
    detail,
    adminOpenid: auth.openid,
    adminName: auth.user?.nickName || "管理员",
  });
};

const getFormTemplate = async (event) => {
  try {
    const { templateId, forAdmin } = event.data || {};
    if (forAdmin) {
      const auth = await requireAdmin("read");
      if (!auth.ok) return auth.result;
    }

    const template = forAdmin
      ? await getTemplateById(templateId)
      : await getActiveTemplate(templateId);
    const quota = await checkFormQuota(template);
    return {
      success: true,
      template: sanitizeTemplate(template, !!forAdmin),
      quotaRemaining: quota.remaining,
      quotaFull: !quota.ok,
    };
  } catch (e) {
    if (e.code === "TEMPLATE_NOT_FOUND" || e.code === "TEMPLATE_DISABLED") {
      return { success: false, errMsg: e.message };
    }
    return { success: false, errMsg: formatCloudError(e) || "获取表单失败" };
  }
};

const checkFormQuota = async (template) => {
  const max = Number(template.settings?.maxSubmissions || 0);
  if (!max || max <= 0) return { ok: true };

  const _ = db.command;
  let query = db.collection(FORM_COLLECTION);
  if (template._id) {
    query = query.where({ templateId: template._id });
  }
  const count = await query.count();
  if (count.total >= max) {
    return { ok: false, errMsg: template.settings?.quotaFullMsg || "名额已满，感谢关注" };
  }
  return { ok: true, remaining: max - count.total };
};

const verifyFormPasswordApi = async (event) => {
  try {
    const { templateId, password } = event.data || {};
    const template = await getActiveTemplate(templateId);
    const check = verifyFormPassword(template, password);
    if (!check.ok) return { success: false, errMsg: check.errMsg };
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "验证失败" };
  }
};

const checkSubmitLimit = async (openid, template, phone = "") => {
  const limit = template.settings?.submitLimit || "none";
  if (limit === "none") return { ok: true };

  const _ = db.command;
  const ownerQuery = _.and([
    buildSubmissionOwnerWhere(openid, phone),
    ...(template._id ? [{ templateId: template._id }] : []),
  ]);

  if (limit === "once") {
    const existing = await db.collection(FORM_COLLECTION).where(ownerQuery).count();
    if (existing.total > 0) {
      return { ok: false, errMsg: "您已提交过，每人仅限提交1次" };
    }
  }

  if (limit === "daily") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const _cmd = db.command;
    const dailyQuery = _.and([
      ownerQuery,
      { createTime: _cmd.gte(startOfDay) },
    ]);
    const existing = await db.collection(FORM_COLLECTION).where(dailyQuery).count();
    if (existing.total > 0) {
      return { ok: false, errMsg: "今日已提交，请明天再试" };
    }
  }

  return { ok: true };
};

const checkRateLimit = async (openid, template, phone = "") => {
  const max = Number(template.settings?.maxSubmitsPerHour || 0);
  if (!max) return { ok: true };

  const hourAgo = new Date(Date.now() - 3600000);
  const _ = db.command;
  const whereClause = template._id
    ? _.and([
        buildSubmissionOwnerWhere(openid, phone),
        { templateId: template._id },
        { createTime: _.gte(hourAgo) },
      ])
    : _.and([buildSubmissionOwnerWhere(openid, phone), { createTime: _.gte(hourAgo) }]);
  const result = await db.collection(FORM_COLLECTION).where(whereClause).count();
  if (result.total >= max) {
    return {
      ok: false,
      errMsg: template.settings?.rateLimitMsg || "提交过于频繁，请稍后再试",
    };
  }
  return { ok: true };
};

const checkDeviceLimit = async (deviceId, template) => {
  const settings = template.settings || {};
  if (!settings.deviceLimitEnabled || !deviceId) return { ok: true };

  const max = Number(settings.maxSubmitsPerDevice || 3);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const _ = db.command;
  const result = await db
    .collection(FORM_COLLECTION)
        .where({
      templateId: template._id,
      deviceId: String(deviceId).slice(0, 64),
      createTime: _.gte(startOfDay),
    })
    .count();
  if (result.total >= max) {
    return {
      ok: false,
      errMsg: settings.deviceLimitMsg || "该设备今日提交次数已达上限",
    };
  }
  return { ok: true };
};

const checkIpLimit = async (clientIp, template) => {
  const settings = template.settings || {};
  if (!settings.ipLimitEnabled || !clientIp) return { ok: true };

  const max = Number(settings.maxSubmitsPerIp || 10);
  const hourAgo = new Date(Date.now() - 3600000);
  const _ = db.command;
  const result = await db
    .collection(FORM_COLLECTION)
    .where({
      templateId: template._id,
      clientIp: String(clientIp).slice(0, 64),
      createTime: _.gte(hourAgo),
    })
    .count();
  if (result.total >= max) {
    return {
      ok: false,
      errMsg: settings.ipLimitMsg || "当前网络提交过于频繁，请稍后再试",
    };
  }
  return { ok: true };
};

const getCaptcha = async () => {
  try {
    await ensureCollection(CAPTCHA_COLLECTION);
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    const answer = String(a + b);
    const captchaId = `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    await db.collection(CAPTCHA_COLLECTION).doc(captchaId).set({
          data: {
        answer,
        used: false,
        expireAt: Date.now() + 5 * 60 * 1000,
        createTime: db.serverDate(),
          },
        });
    return { success: true, captchaId, question: `${a} + ${b} = ?` };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "获取验证码失败" };
  }
};

const verifyCaptchaAnswer = async (template, captchaId, captchaAnswer) => {
  if (!template.settings?.captchaEnabled) return { ok: true };
  if (!captchaId || captchaAnswer === undefined || captchaAnswer === "") {
    return { ok: false, errMsg: "请完成验证码" };
  }
  try {
    await ensureCollection(CAPTCHA_COLLECTION);
    const doc = await db.collection(CAPTCHA_COLLECTION).doc(captchaId).get();
    const item = doc.data;
    if (!item || item.used) return { ok: false, errMsg: "验证码已失效，请刷新" };
    if (Date.now() > item.expireAt) return { ok: false, errMsg: "验证码已过期" };
    if (String(captchaAnswer).trim() !== String(item.answer)) {
      return { ok: false, errMsg: "验证码错误" };
    }
    const _ = db.command;
    const updateRes = await db
      .collection(CAPTCHA_COLLECTION)
      .where({ _id: captchaId, used: _.neq(true) })
      .update({ data: { used: true } });
    if (!updateRes.stats?.updated) {
      return { ok: false, errMsg: "验证码已失效，请刷新" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, errMsg: "验证码校验失败" };
  }
};

const generateCheckCode = async () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const exists = await db.collection(FORM_COLLECTION).where({ checkCode: code }).count();
    if (!exists.total) return code;
  }
  return `C${Date.now().toString(36).slice(-5).toUpperCase()}`;
};

/** 表单编号：SB + 年月日 + 4位随机码，如 SB20260715A3K9 */
const generateFormNo = async () => {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    const formNo = `SB${datePart}${suffix}`;
    const exists = await db.collection(FORM_COLLECTION).where({ formNo }).count();
    if (!exists.total) return formNo;
  }
  return `SB${datePart}${Date.now().toString(36).slice(-4).toUpperCase()}`;
};

const checkDuplicateSubmission = async (openid, template, answers, phone = "") => {
  if (!template.settings?.duplicateCheckEnabled) return { ok: true };

  const windowMs = Number(template.settings.duplicateWindowMinutes || 5) * 60000;
  const _ = db.command;
  const result = await db
    .collection(FORM_COLLECTION)
    .where(_.and([{ templateId: template._id }, buildSubmissionOwnerWhere(openid, phone)]))
    .orderBy("createTime", "desc")
    .limit(1)
    .get();
  const last = result.data?.[0];
  if (!last?.createTime) return { ok: true };

  const elapsed = Date.now() - new Date(last.createTime).getTime();
  if (elapsed > windowMs) return { ok: true };

  if (stableStringify(last.answers || {}) === stableStringify(answers || {})) {
    return {
      ok: false,
      errMsg: template.settings.duplicateMsg || "请勿重复提交相同内容",
    };
  }
  return { ok: true };
};

const normalizeClientRequestId = (value) => {
  if (value === undefined || value === null || value === "") return "";
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(normalized) ? normalized : null;
};

const buildSubmissionDocumentId = (openid, clientRequestId) =>
  `s_${crypto
    .createHash("sha256")
    .update(`${openid}\0${clientRequestId}`)
    .digest("hex")
    .slice(0, 30)}`;

const buildSubmissionSuccessResult = (item, template = null, idempotent = false) => {
  const paymentAmount = Number(item?.paymentAmount || 0);
  const needPayment =
    paymentAmount > 0 && !["paid", "refunded"].includes(item?.paymentStatus);
    return {
      success: true,
    id: item?._id || "",
    needPayment,
    paymentAmount: paymentAmount > 0 ? paymentAmount : 0,
    checkCode: item?.checkCode || "",
    formNo: item?.formNo || "",
    successTitle:
      item?.successTitleSnapshot || template?.settings?.successTitle || "提交成功",
    successDesc: item?.successDescSnapshot || template?.settings?.successDesc || "",
    idempotent,
  };
};

const submitForm = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(FORM_COLLECTION);
    const {
      templateId,
      answers,
      formPassword,
      submitterNotifyAccepted,
      captchaId,
      captchaAnswer,
      deviceId,
      clientRequestId,
    } = event.data || {};

    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return { success: false, errMsg: "提交数据无效" };
    }

    const safeClientRequestId = normalizeClientRequestId(clientRequestId);
    if (safeClientRequestId === null) {
      return { success: false, errMsg: "提交请求标识无效，请重试" };
    }
    const submissionDocId = safeClientRequestId
      ? buildSubmissionDocumentId(auth.openid, safeClientRequestId)
      : "";

    if (submissionDocId) {
      const existingResult = await db
        .collection(FORM_COLLECTION)
        .where({ _id: submissionDocId })
        .limit(1)
        .get();
      const existing = existingResult.data?.[0];
      if (existing) {
        const sameTemplate = !templateId || existing.templateId === templateId;
        const sameAnswers =
          stableStringify(existing.answers || {}) === stableStringify(answers || {});
        if (!sameTemplate || !sameAnswers) {
    return {
      success: false,
            errMsg: "提交请求标识冲突，请重新提交",
          };
        }
        return buildSubmissionSuccessResult(existing, null, true);
      }
    }

    let template;
    try {
      template = await getActiveTemplate(templateId);
    } catch (e) {
      if (e.code === "TEMPLATE_NOT_FOUND" || e.code === "TEMPLATE_DISABLED") {
        return { success: false, errMsg: e.message };
      }
      throw e;
    }

    const scheduleCheck = checkFormSchedule(template);
    if (!scheduleCheck.ok) return { success: false, errMsg: scheduleCheck.errMsg };

    const passwordCheck = verifyFormPassword(template, formPassword);
    if (!passwordCheck.ok) return { success: false, errMsg: passwordCheck.errMsg };

    const quotaCheck = await checkFormQuota(template);
    if (!quotaCheck.ok) return { success: false, errMsg: quotaCheck.errMsg };

    const validation = validateAnswers(template.fields || [], answers);
    if (!validation.ok) return { success: false, errMsg: validation.errMsg };

    const whitelistCheck = checkPhoneWhitelist(template, answers, auth.user);
    if (!whitelistCheck.ok) return { success: false, errMsg: whitelistCheck.errMsg };

    // share/friend/group 访问模式依赖客户端场景，服务端无法可靠校验，仅作提示性限制
    // 真正的访问控制请使用密码、白名单、openid 白名单
    const accessMode = template.settings?.accessMode;
    if (accessMode === "group_only" || accessMode === "share_only" || accessMode === "friend_only") {
      // 保留客户端校验体验；服务端不再信任 event.data.launchScene / groupVerified
    }

    const openidCheck = checkOpenidWhitelist(template, auth.openid);
    if (!openidCheck.ok) return { success: false, errMsg: openidCheck.errMsg };

    const limitCheck = await checkSubmitLimit(auth.openid, template, auth.user?.phone || "");
    if (!limitCheck.ok) return { success: false, errMsg: limitCheck.errMsg };

    const rateCheck = await checkRateLimit(auth.openid, template, auth.user?.phone || "");
    if (!rateCheck.ok) return { success: false, errMsg: rateCheck.errMsg };

    const captchaCheck = await verifyCaptchaAnswer(template, captchaId, captchaAnswer);
    if (!captchaCheck.ok) return { success: false, errMsg: captchaCheck.errMsg };

    const duplicateCheck = await checkDuplicateSubmission(
      auth.openid,
      template,
      answers,
      auth.user?.phone || ""
    );
    if (!duplicateCheck.ok) return { success: false, errMsg: duplicateCheck.errMsg };

    const wxContext = cloud.getWXContext();
    const clientIp = wxContext.CLIENTIP || wxContext.CLIENTIPV6 || "";
    const safeDeviceId = deviceId ? String(deviceId).slice(0, 64) : "";

    const deviceCheck = await checkDeviceLimit(safeDeviceId, template);
    if (!deviceCheck.ok) return { success: false, errMsg: deviceCheck.errMsg };

    const ipCheck = await checkIpLimit(clientIp, template);
    if (!ipCheck.ok) return { success: false, errMsg: ipCheck.errMsg };

    // 提交前再次校验名额，降低并发超卖概率
    const quotaRecheck = await checkFormQuota(template);
    if (!quotaRecheck.ok) return { success: false, errMsg: quotaRecheck.errMsg };

    const paymentAmount = Number(template.settings?.paymentAmount || 0);
    const needPayment = paymentAmount > 0;
    const checkinEnabled = !!template.settings?.checkinEnabled;
    const checkCode = checkinEnabled && !needPayment ? await generateCheckCode() : "";
    const formNo = await generateFormNo();
    const submitPhone =
      extractSubmitPhone(template.fields || [], answers, auth.user, {
        allowProfilePhone: true,
      }) || "";

    const submissionData = {
      templateId: template._id,
      templateTitle: template.title,
      answers,
      status: needPayment ? "unpaid" : "pending",
      paymentStatus: needPayment ? "unpaid" : "none",
      paymentAmount: needPayment ? paymentAmount : 0,
      paymentMchIdSnapshot: needPayment ? String(template.settings?.paymentMchId || "").trim() : "",
      checkinEnabledSnapshot: checkinEnabled,
      checkCode,
      formNo,
      checkedIn: false,
      remark: "",
      openid: auth.openid,
      phone: submitPhone,
      deviceId: safeDeviceId,
      clientIp: clientIp ? String(clientIp).slice(0, 64) : "",
      clientRequestId: safeClientRequestId || "",
      submitterNotifyAccepted: !!submitterNotifyAccepted,
      successTitleSnapshot: template.settings?.successTitle || "提交成功",
      successDescSnapshot: template.settings?.successDesc || "",
      createTime: db.serverDate(),
    };

    let submissionId = submissionDocId;
    if (submissionDocId) {
      await db.collection(FORM_COLLECTION).doc(submissionDocId).set({ data: submissionData });
    } else {
      const result = await db.collection(FORM_COLLECTION).add({ data: submissionData });
      submissionId = result._id;
    }
    const submissionRecord = { ...submissionData, _id: submissionId };

    notifyAdminsByEmailOnSubmit(template, submissionId, answers, {
      status: needPayment ? "unpaid" : "pending",
      createTime: new Date(),
      formNo,
    }).catch(() => {});

    if (!needPayment) {
      notifyAdminsOnSubmit(template, submissionId, answers).catch(() => {});
      const summary = getSummaryFromItem({ answers, templateTitle: template.title });
      sendSmsWebhook(template.settings, {
        event: "submit",
        phone: summary.phone,
        name: summary.name,
        templateTitle: template.title,
      }).catch(() => {});
    }

    return buildSubmissionSuccessResult(submissionRecord, template);
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "提交失败" };
  }
};

const getMyForms = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(FORM_COLLECTION);
    const { page = 1, pageSize = 10 } = event.data || {};
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safePageSize = Math.min(10, Math.max(1, Math.floor(Number(pageSize) || 10)));
    const skip = (safePage - 1) * safePageSize;
    const query = db
      .collection(FORM_COLLECTION)
      .where(buildSubmissionOwnerWhere(auth.openid, auth.user?.phone || ""));
    const [countResult, pageResult] = await Promise.all([
      query.count(),
      query.orderBy("createTime", "desc").skip(skip).limit(safePageSize).get(),
    ]);

    const items = pageResult.data || [];
    const templateIds = [...new Set(items.map((item) => item.templateId).filter(Boolean))];
    const settingsMap = {};

    await Promise.all(
      templateIds.map(async (tid) => {
        try {
          const tpl = await db.collection(TEMPLATE_COLLECTION).doc(tid).get();
          settingsMap[tid] = tpl.data?.settings || {};
        } catch (e) {
          settingsMap[tid] = {};
        }
      })
    );

    const data = items.map((item) => ({
      ...item,
      canEdit: canUserEditSubmission(item, settingsMap[item.templateId] || {}),
    }));

    return {
      success: true,
      data,
      total: Number(countResult.total || 0),
      page: safePage,
      pageSize: safePageSize,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "\u67e5\u8be2\u5931\u8d25" };
  }
};

const getMySubmissionForEdit = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { id } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };

    const doc = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "记录不存在" };

    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "无权修改此记录" };
    }

    const template = item.templateId
      ? await db.collection(TEMPLATE_COLLECTION).doc(item.templateId).get().then((r) => r.data).catch(() => null)
      : null;
    const activeTemplate = template || (await ensureDefaultTemplate());

    if (!canUserEditSubmission(item, activeTemplate.settings || {})) {
      return { success: false, errMsg: "当前记录不可修改" };
    }

    return {
      success: true,
      submission: item,
      template: sanitizeTemplate(activeTemplate),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const updateMySubmission = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { id, answers } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };
    if (!answers || typeof answers !== "object") {
      return { success: false, errMsg: "提交数据无效" };
    }

    const doc = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "记录不存在" };

    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "无权修改此记录" };
    }

    let template = null;
    if (item.templateId) {
      try {
        template = (await db.collection(TEMPLATE_COLLECTION).doc(item.templateId).get()).data;
      } catch (e) {
        /* fallback */
      }
    }
    if (!template) template = await ensureDefaultTemplate();

    if (!canUserEditSubmission(item, template.settings || {})) {
      return { success: false, errMsg: "当前记录不可修改" };
    }

    const validation = validateAnswers(template.fields || [], answers);
    if (!validation.ok) return { success: false, errMsg: validation.errMsg };

    const submitPhone =
      extractSubmitPhone(template.fields || [], answers, auth.user, {
        allowProfilePhone: true,
      }) ||
      item.phone ||
      "";

    await db.collection(FORM_COLLECTION).doc(id).update({
      data: {
        answers,
        phone: submitPhone,
        openid: auth.openid,
        editedByUser: true,
        updateTime: db.serverDate(),
      },
    });

    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const deleteMySubmission = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { id } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };

    const doc = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "记录不存在" };

    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "无权删除此记录" };
    }

    await db.collection(FORM_COLLECTION).doc(id).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "删除失败" };
  }
};

const batchDeleteMySubmissions = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { ids = [] } = event.data || {};
    if (!ids.length) return { success: false, errMsg: "请选择记录" };

    const uniqueIds = [...new Set(ids.map(String))].slice(0, 50);
    let deleted = 0;

    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const doc = await db.collection(FORM_COLLECTION).doc(id).get();
          const item = doc.data;
          if (!item) return;
          if (!ownsSubmission(item, auth)) return;
          await db.collection(FORM_COLLECTION).doc(id).remove();
          deleted += 1;
        } catch (e) {
          /* skip invalid ids */
        }
      })
    );

    if (!deleted) return { success: false, errMsg: "没有可删除的记录" };
    return { success: true, count: deleted };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "批量删除失败" };
  }
};

const SUBMISSION_QUERY_BATCH_SIZE = 500;
const MAX_FILTER_SCAN_ROWS = 20000;
const MAX_EXPORT_ROWS = 10000;
const VALID_SUBMISSION_STATUSES = new Set(["pending", "processed", "rejected", "unpaid"]);

const parseFilterDate = (value, endOfDay = false) => {
  if (!value) return null;
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("\u65e5\u671f\u683c\u5f0f\u65e0\u6548");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return date;
};

const buildSubmissionQuery = ({ status = "all", templateId = "", dateFrom = "", dateTo = "" } = {}) => {
  const _ = db.command;
  const conditions = [];
  const from = parseFilterDate(dateFrom, false);
  const to = parseFilterDate(dateTo, true);
  if (from && to && from.getTime() > to.getTime()) {
    throw new Error("\u5f00\u59cb\u65e5\u671f\u4e0d\u80fd\u665a\u4e8e\u7ed3\u675f\u65e5\u671f");
  }
  if (VALID_SUBMISSION_STATUSES.has(status)) conditions.push({ status });
  if (templateId) conditions.push({ templateId: String(templateId) });
  if (from) conditions.push({ createTime: _.gte(from) });
  if (to) conditions.push({ createTime: _.lte(to) });

  let query = db.collection(FORM_COLLECTION);
  if (conditions.length === 1) query = query.where(conditions[0]);
  else if (conditions.length > 1) query = query.where(_.and(conditions));
  return query;
};

const fetchSubmissionRows = async (query, maxRows = MAX_FILTER_SCAN_ROWS) => {
  const rows = [];
  let offset = 0;
  while (rows.length <= maxRows) {
    const limit = Math.min(SUBMISSION_QUERY_BATCH_SIZE, maxRows + 1 - rows.length);
    const result = await query.orderBy("createTime", "desc").skip(offset).limit(limit).get();
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }
  if (rows.length > maxRows) {
    throw new Error(`\u7b5b\u9009\u7ed3\u679c\u8d85\u8fc7 ${maxRows} \u6761\uff0c\u8bf7\u7f29\u5c0f\u65e5\u671f\u6216\u8868\u5355\u8303\u56f4`);
  }
  return rows;
};

const countSubmissions = async (filters = {}) => {
  const result = await buildSubmissionQuery(filters).count();
  return Number(result.total || 0);
};

const getFormStats = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(FORM_COLLECTION);
    const {
      templateId = "",
      keyword = "",
      dateFrom = "",
      dateTo = "",
      phone = "",
      typeValue = "",
      fieldId = "",
    } = (event && event.data) || {};
    const baseFilters = { templateId, dateFrom, dateTo };
    const hasClientFilter = !!(String(keyword).trim() || String(phone).trim() || String(typeValue).trim());

    if (hasClientFilter) {
      const rows = await fetchSubmissionRows(buildSubmissionQuery(baseFilters));
      const data = filterSubmissions(rows, {
        keyword,
        phone,
        typeValue,
        fieldId,
        templateId,
      });
      const stats = { total: 0, pending: 0, processed: 0, rejected: 0, unpaid: 0 };
      data.forEach((item) => {
        stats.total += 1;
        if (Object.prototype.hasOwnProperty.call(stats, item.status)) stats[item.status] += 1;
      });
      return { success: true, stats };
    }

    const [total, pending, processed, rejected, unpaid] = await Promise.all([
      countSubmissions(baseFilters),
      countSubmissions({ ...baseFilters, status: "pending" }),
      countSubmissions({ ...baseFilters, status: "processed" }),
      countSubmissions({ ...baseFilters, status: "rejected" }),
      countSubmissions({ ...baseFilters, status: "unpaid" }),
    ]);
    return { success: true, stats: { total, pending, processed, rejected, unpaid } };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || e.message || "\u7edf\u8ba1\u5931\u8d25" };
  }
};

const formatDateKey = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const getFormAnalytics = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(FORM_COLLECTION);
    const [total, pending, processed, data, refundPendingCount] = await Promise.all([
      db.collection(FORM_COLLECTION).count(),
      db.collection(FORM_COLLECTION).where({ status: "pending" }).count(),
      db.collection(FORM_COLLECTION).where({ status: "processed" }).count(),
      fetchSubmissionRows(buildSubmissionQuery(), MAX_FILTER_SCAN_ROWS),
      db.collection(FORM_COLLECTION).where({ refundStatus: "pending" }).count(),
    ]);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);

    let todayCount = 0;
    let weekCount = 0;

    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const key = formatDateKey(d);
      dailyMap[key] = {
        date: key,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        count: 0,
      };
    }

    const typeCount = {};
    data.forEach((item) => {
      const t = item.createTime ? new Date(item.createTime) : null;
      if (t) {
        if (t >= todayStart) todayCount++;
        if (t >= weekStart) weekCount++;
        const key = formatDateKey(t);
        if (dailyMap[key]) dailyMap[key].count++;
      }
      const summary = getSummaryFromItem(item);
      const typeLabel = summary.type || "其他";
      typeCount[typeLabel] = (typeCount[typeLabel] || 0) + 1;
    });

    const dailyTrend = Object.values(dailyMap);
    const maxDaily = Math.max(...dailyTrend.map((d) => d.count), 1);
    dailyTrend.forEach((d) => {
      d.percent = Math.round((d.count / maxDaily) * 100);
    });

    const typeBreakdown = Object.entries(typeCount)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const maxType = Math.max(...typeBreakdown.map((t) => t.count), 1);
    typeBreakdown.forEach((t) => {
      t.percent = Math.round((t.count / maxType) * 100);
    });

    const template = await ensureDefaultTemplate();
    const fieldStats = buildFieldStats(template.fields || [], data);
    const anomalies = detectAnomalies(data, Number(template.settings?.anomalyThreshold || 3));
    const refundPending = Number(refundPendingCount.total || 0);
    const dailyDigest = [
      `【表单日报 ${formatDateKey(now)}】`,
      `今日提交 ${todayCount} 条，待处理 ${pending.total} 条`,
      `近7日 ${weekCount} 条，异常 ${anomalies.length} 项`,
      refundPending ? `待退款 ${refundPending} 条` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      stats: {
        total: total.total,
        pending: pending.total,
        processed: processed.total,
        todayCount,
        weekCount,
        refundPending,
      },
      dailyTrend,
      typeBreakdown,
      fieldStats,
      anomalies,
      dailyDigest,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "统计失败" };
  }
};

const updateFormTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { templateId, title, description, settings, fields, sections } = event.data || {};
    const template = await getTemplateById(templateId);

    const updateData = { updateTime: db.serverDate() };
    if (title !== undefined) updateData.title = String(title).trim();
    if (description !== undefined) updateData.description = String(description).trim();
    if (event.data?.enabled !== undefined) updateData.enabled = !!event.data.enabled;
    if (settings !== undefined && typeof settings === "object") {
      const mergedSettings = { ...(template.settings || {}), ...settings };
      if (Object.prototype.hasOwnProperty.call(settings, "accessPassword")) {
        const incomingPassword = String(settings.accessPassword || "");
        if (incomingPassword === "********") {
          if (template.settings?.accessPasswordHash && template.settings?.accessPasswordSalt) {
            mergedSettings.accessPasswordHash = template.settings.accessPasswordHash;
            mergedSettings.accessPasswordSalt = template.settings.accessPasswordSalt;
          } else if (template.settings?.accessPassword) {
            Object.assign(mergedSettings, hashFormPassword(template.settings.accessPassword));
          }
          delete mergedSettings.accessPassword;
        } else if (incomingPassword) {
          Object.assign(mergedSettings, hashFormPassword(incomingPassword));
          delete mergedSettings.accessPassword;
        } else {
          delete mergedSettings.accessPassword;
          delete mergedSettings.accessPasswordHash;
          delete mergedSettings.accessPasswordSalt;
        }
      } else if (mergedSettings.accessPassword && !mergedSettings.accessPasswordHash) {
        Object.assign(mergedSettings, hashFormPassword(mergedSettings.accessPassword));
        delete mergedSettings.accessPassword;
      }
      // 首页入口：未指定时按新/旧标题推断，改名后仍保持绑定
      const prevHomeKey = String(template.settings?.homeServiceKey || "").trim();
      let nextHomeKey = String(mergedSettings.homeServiceKey || "").trim();
      if (!nextHomeKey) {
        const inferHomeServiceKey = (title) => {
          const text = String(title || "").replace(/\s+/g, "").trim();
          if (!text) return "";
          const homeRules = [
            { key: "special", keys: ["专精代为", "专精特新", "专精"] },
            { key: "tender", keys: ["标书代为", "标书代写", "标书代办", "代写标书", "标书", "投标", "招标文件"] },
            { key: "declare", keys: ["证书委托", "证书"] },
            { key: "high", keys: ["高新代为", "高新代办", "高新"] },
            { key: "talent", keys: ["人才合作", "人才"] },
            { key: "other", keys: ["其他需求"] },
          ];
          let bestKey = "";
          let bestLen = 0;
          homeRules.forEach((rule) => {
            (rule.keys || []).forEach((word) => {
              const needle = String(word || "").replace(/\s+/g, "");
              if (needle && text.includes(needle) && needle.length > bestLen) {
                bestKey = rule.key;
                bestLen = needle.length;
              }
            });
          });
          return bestKey;
        };
        nextHomeKey =
          prevHomeKey ||
          inferHomeServiceKey(updateData.title) ||
          inferHomeServiceKey(template.title) ||
          "";
      }
      mergedSettings.homeServiceKey = nextHomeKey;
      updateData.settings = mergedSettings;
    }
    if (fields !== undefined && Array.isArray(fields)) {
      updateData.fields = fields.filter((field) => field && field.type !== "location");
    }
    if (sections !== undefined && Array.isArray(sections)) {
      updateData.sections = sections;
    }

    await db.collection(TEMPLATE_COLLECTION).doc(template._id).update({ data: updateData });
    const updated = await db.collection(TEMPLATE_COLLECTION).doc(template._id).get();
    await logAdminAction(auth, "update_template", template._id, {
      title: updateData.title || template.title,
    });
    return { success: true, template: sanitizeTemplate(updated.data, true) };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const getAllForms = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(FORM_COLLECTION);
    const {
      status = "all",
      page = 1,
      pageSize = 10,
      keyword = "",
      dateFrom = "",
      dateTo = "",
      phone = "",
      typeValue = "",
      fieldId = "",
      templateId = "",
    } = event.data || {};
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safePageSize = Math.min(10, Math.max(1, Math.floor(Number(pageSize) || 10)));
    const skip = (safePage - 1) * safePageSize;
    const queryFilters = { status, templateId, dateFrom, dateTo };
    const query = buildSubmissionQuery(queryFilters);
    const hasClientFilter = !!(String(keyword).trim() || String(phone).trim() || String(typeValue).trim());

    if (!hasClientFilter) {
      const [countResult, pageResult] = await Promise.all([
        query.count(),
        query.orderBy("createTime", "desc").skip(skip).limit(safePageSize).get(),
      ]);
      return {
        success: true,
        data: pageResult.data || [],
        total: Number(countResult.total || 0),
        page: safePage,
        pageSize: safePageSize,
      };
    }

    const rows = await fetchSubmissionRows(query);
    const data = filterSubmissions(rows, { keyword, phone, typeValue, fieldId, templateId });
    return {
      success: true,
      data: data.slice(skip, skip + safePageSize),
      total: data.length,
      page: safePage,
      pageSize: safePageSize,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || e.message || "\u67e5\u8be2\u5931\u8d25" };
  }
};

const getFormDetail = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    const { id } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };

    const result = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = result.data;
    if (!item) return { success: false, errMsg: "记录不存在" };

    let templateFields = [];
    if (item.templateId) {
      try {
        const tpl = await db.collection(TEMPLATE_COLLECTION).doc(item.templateId).get();
        templateFields = tpl.data?.fields || [];
      } catch (e) {
        /* fallback */
      }
    }
    if (!templateFields.length) {
      const tpl = await ensureDefaultTemplate();
      templateFields = tpl.fields || [];
    }

    return { success: true, data: item, templateFields };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "查询失败" };
  }
};

const updateFormStatus = async (event) => {
  const auth = await requireAdmin("edit");
  if (!auth.ok) return auth.result;

  try {
    const { id, status, remark, adminGrade } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };

    const updateData = { updateTime: db.serverDate() };
    if (status && ["pending", "processed", "rejected"].includes(status)) {
      updateData.status = status;
    }
    if (remark !== undefined) updateData.remark = remark;
    if (adminGrade !== undefined && adminGrade !== null && adminGrade !== "") {
      updateData.adminGrade = Number(adminGrade);
    }

    await db.collection(FORM_COLLECTION).doc(id).update({ data: updateData });
    await logAdminAction(auth, "update_status", id, { status, remark });

    if (status && ["processed", "rejected"].includes(status)) {
      const doc = await db.collection(FORM_COLLECTION).doc(id).get();
      if (doc.data) {
        notifySubmitterOnStatus(doc.data, status).catch(() => {});
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "更新失败" };
  }
};

const updateFormSubmission = async (event) => {
  const auth = await requireAdmin("edit");
  if (!auth.ok) return auth.result;

  try {
    const { id, answers } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };
    if (!answers || typeof answers !== "object") {
      return { success: false, errMsg: "提交数据无效" };
    }

    const doc = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "记录不存在" };

    let templateFields = [];
    if (item.templateId) {
      try {
        const tpl = await db.collection(TEMPLATE_COLLECTION).doc(item.templateId).get();
        templateFields = tpl.data?.fields || [];
      } catch (e) {
        /* fallback */
      }
    }
    if (!templateFields.length) {
      const tpl = await ensureDefaultTemplate();
      templateFields = tpl.fields || [];
    }

    const validation = validateAnswers(templateFields, answers);
    if (!validation.ok) return { success: false, errMsg: validation.errMsg };

    await db.collection(FORM_COLLECTION).doc(id).update({
      data: {
        answers,
        editedByAdmin: true,
        updateTime: db.serverDate(),
      },
    });

    await logAdminAction(auth, "edit_submission", id, { fieldCount: Object.keys(answers).length });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const deleteFormSubmission = async (event) => {
  const auth = await requireAdmin("delete");
  if (!auth.ok) return auth.result;

  try {
    const { id } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少记录 ID" };

    await db.collection(FORM_COLLECTION).doc(id).remove();
    await logAdminAction(auth, "delete_submission", id);
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "删除失败" };
  }
};

const exportForms = async (event) => {
  const auth = await requireAdmin("export");
  if (!auth.ok) return auth.result;

  try {
    const {
      status = "all",
      keyword = "",
      dateFrom = "",
      dateTo = "",
      format = "csv",
      fieldIds = [],
      templateId = "",
      phone = "",
      typeValue = "",
      fieldId = "",
    } = event.data || {};
    const query = buildSubmissionQuery({ status, templateId, dateFrom, dateTo });
    const rows = await fetchSubmissionRows(query, MAX_EXPORT_ROWS);
    const data = filterSubmissions(rows, { keyword, phone, typeValue, fieldId, templateId });

    const defaultTemplate = await ensureDefaultTemplate();
    let allFields;
    if (templateId) {
      const selectedTemplate = await getTemplateById(templateId);
      allFields = selectedTemplate.fields || [];
    } else {
      allFields = await collectBackupFields(data, defaultTemplate);
    }
    let fields = allFields;
    if (Array.isArray(fieldIds) && fieldIds.length) {
      fields = fieldIds.map((id) => allFields.find((field) => field.id === id)).filter(Boolean);
      if (!fields.length) fields = allFields;
    }

    const useExcel = format === "xlsx";
    const fileContent = useExcel ? buildExcel(data, fields) : Buffer.from(buildCSV(data, fields), "utf8");
    const ext = useExcel ? "xlsx" : "csv";
    const upload = await cloud.uploadFile({
      cloudPath: `exports/export-${Date.now()}.${ext}`,
      fileContent,
    });

    let downloadUrl = "";
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: [upload.fileID] });
      downloadUrl = urlRes.fileList?.[0]?.tempFileURL || "";
    } catch (e) {
      /* ignore temporary URL failure */
    }

    await logAdminAction(auth, "export_submissions", "", { count: data.length, format: ext, templateId });
    return { success: true, fileID: upload.fileID, downloadUrl, count: data.length, format: ext };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || e.message || "\u5bfc\u51fa\u5931\u8d25" };
  }
};

const getFormQrCode = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { path = "pages/index/index" } = event.data || {};
    const resp = await cloud.openapi.wxacode.get({ path });
    const upload = await cloud.uploadFile({
      cloudPath: `qrcodes/form-${Date.now()}.png`,
      fileContent: resp.buffer,
    });
    const urlRes = await cloud.getTempFileURL({ fileList: [upload.fileID] });
    return {
      success: true,
      fileID: upload.fileID,
      tempUrl: urlRes.fileList?.[0]?.tempFileURL || "",
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "生成二维码失败" };
  }
};

const saveNotifySubscription = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { templateId } = event.data || {};
    if (!templateId) return { success: false, errMsg: "缺少模板 ID" };

    const subscribedIds = [...new Set([...(auth.user.notifySubscribedIds || []), templateId])];
    const notifySubscriptions = {
      ...(auth.user.notifySubscriptions || {}),
      [templateId]: { subscribed: true, updateTime: new Date().toISOString() },
    };

    await db.collection(USER_COLLECTION).doc(auth.user._id).update({
      data: {
        notifySubscribed: true,
        notifySubscribedIds: subscribedIds,
        notifySubscriptions,
        notifyTemplateId: templateId,
        updateTime: db.serverDate(),
      },
    });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const listNotifyTemplates = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(NOTIFY_TEMPLATE_COLLECTION);
    const res = await db.collection(NOTIFY_TEMPLATE_COLLECTION).orderBy("createTime", "desc").limit(50).get();
    let platformList = [];
    let platformError = "";
    try {
      platformList = await getSubscribeTemplateList();
    } catch (e) {
      // OpenAPI access_token 无效时仍返回本地配置，避免订阅通知页整页失败
      platformError = formatCloudError(e) || "获取公众平台模板失败";
      platformList = [];
      if (/access_token|INVALID_WX_ACCESS_TOKEN|-501001/i.test(platformError)) {
        platformError =
          "微信接口凭证无效，无法同步公众平台模板列表。请确认云环境已关联当前小程序，并重新上传部署云函数；本地已配置的通知模板仍可查看。";
      }
    }
    const subscribedIds = new Set(auth.user.notifySubscribedIds || []);
    const list = (res.data || []).map((item) => ({
      _id: item._id,
      name: item.name || "",
      platformTemplateId: item.platformTemplateId || "",
      platformTemplateTitle: item.platformTemplateTitle || "",
      enabled: item.enabled !== false,
      subscribed: subscribedIds.has(item.platformTemplateId),
      platformExists: !platformError
        ? platformList.some((p) => p.priTmplId === item.platformTemplateId)
        : true,
      createTime: item.createTime,
      updateTime: item.updateTime,
    }));

    return {
      success: true,
      list,
      platformTemplates: platformList.map((item) => ({
        priTmplId: item.priTmplId,
        title: item.title || "",
        type: item.type,
        content: item.content || "",
      })),
      platformError: platformError || "",
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const saveNotifyTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { id, name, platformTemplateId, enabled } = event.data || {};
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return { success: false, errMsg: "请填写模板名称" };
    if (!platformTemplateId) return { success: false, errMsg: "请选择公众平台模板" };

    const platform = await findPlatformTemplate(platformTemplateId);
    if (!platform) {
    return {
      success: false,
        errMsg:
          "公众平台未找到该模板。请确认已在微信公众平台添加；若刚出现 access_token 错误，请先修复云环境与小程序关联后再保存。",
      };
    }

    const data = {
      name: trimmedName,
      platformTemplateId: platform.priTmplId,
      platformTemplateTitle: platform.title || "",
      platformTemplateContent: platform.content || "",
      enabled: enabled !== false,
      updateTime: db.serverDate(),
    };

    await ensureCollection(NOTIFY_TEMPLATE_COLLECTION);
    if (id) {
      await db.collection(NOTIFY_TEMPLATE_COLLECTION).doc(id).update({ data });
      await logAdminAction(auth, "update_notify_template", id, { name: trimmedName });
      return { success: true, id };
    }

    data.createTime = db.serverDate();
    const result = await addDocument(NOTIFY_TEMPLATE_COLLECTION, data);
    await logAdminAction(auth, "create_notify_template", result._id, { name: trimmedName });
    return { success: true, id: result._id };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存失败" };
  }
};

const deleteNotifyTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { id } = event.data || {};
    if (!id) return { success: false, errMsg: "缺少模板 ID" };

    const used = await db
      .collection(TEMPLATE_COLLECTION)
      .where({ "settings.notifyConfigId": id })
      .limit(1)
      .get();
    if ((used.data || []).length) {
      return { success: false, errMsg: "有表单正在使用该通知模板，请先在消息通知页解除关联" };
    }

    await db.collection(NOTIFY_TEMPLATE_COLLECTION).doc(id).remove();
    await logAdminAction(auth, "delete_notify_template", id, {});
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "删除失败" };
  }
};


const EMAIL_DOC_ID = "default";

const normalizeEmailList = (value) => {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,;\uFF0C\uFF1B\s]+/);
  return [
    ...new Set(
      list
        .map((item) => String(item || "").trim())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    ),
  ];
};

const normalizeSmtpHost = (host = "") => String(host || "").trim().replace(/^smtp:\/\//i, "");

const maskSecret = (value = "") => {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
};

const sanitizeEmailConfigForClient = (config = {}) => ({
  enabled: config.enabled !== false,
  smtpHost: config.smtpHost || "",
  smtpPort: Number(config.smtpPort || 465),
  smtpSecure: config.smtpSecure !== false,
  smtpUser: config.smtpUser || "",
  hasPassword: !!config.smtpPass,
  passwordMask: maskSecret(config.smtpPass),
  fromEmail: config.fromEmail || config.smtpUser || "",
  fromName: config.fromName || "\u8868\u5355\u901a\u77e5",
  adminEmails: normalizeEmailList(config.adminEmails || []).join("\n"),
  createTime: config.createTime || "",
  updateTime: config.updateTime || "",
});

const getDefaultEmailConfig = async () => {
  try {
    await ensureCollection(EMAIL_CONFIG_COLLECTION);
    try {
      const doc = await db.collection(EMAIL_CONFIG_COLLECTION).doc(EMAIL_DOC_ID).get();
      if (doc.data) return { ...doc.data, _id: EMAIL_DOC_ID };
    } catch (e) {
      // Compatible with old configs created by add().
    }
    const res = await db.collection(EMAIL_CONFIG_COLLECTION).orderBy("updateTime", "desc").limit(1).get();
    return (res.data || [])[0] || null;
  } catch (e) {
    return null;
  }
};

const validateEmailConfig = (input = {}, oldConfig = {}) => {
  const enabled = input.enabled !== false;
  const smtpHost = normalizeSmtpHost(input.smtpHost);
  const smtpSecure = input.smtpSecure !== false;
  const smtpPort = Number(input.smtpPort || (smtpSecure ? 465 : 587));
  const smtpUser = String(input.smtpUser || "").trim();
  const smtpPass = String(input.smtpPass || "").trim() || oldConfig.smtpPass || "";
  const fromEmail = String(input.fromEmail || smtpUser || "").trim();
  const fromName = String(input.fromName || "\u8868\u5355\u901a\u77e5").trim().slice(0, 40) || "\u8868\u5355\u901a\u77e5";
  const adminEmails = normalizeEmailList(input.adminEmails);

  if (enabled) {
    if (!smtpHost) return { ok: false, errMsg: "\u8bf7\u586b\u5199 SMTP \u670d\u52a1\u5668\u5730\u5740" };
    if (!smtpPort || smtpPort < 1 || smtpPort > 65535) return { ok: false, errMsg: "SMTP \u7aef\u53e3\u4e0d\u6b63\u786e" };
    if (!smtpUser) return { ok: false, errMsg: "\u8bf7\u586b\u5199\u53d1\u4ef6\u90ae\u7bb1\u8d26\u53f7" };
    if (!smtpPass) return { ok: false, errMsg: "\u8bf7\u586b\u5199\u90ae\u7bb1\u6388\u6743\u7801\u6216 SMTP \u5bc6\u7801" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) return { ok: false, errMsg: "\u53d1\u4ef6\u90ae\u7bb1\u683c\u5f0f\u4e0d\u6b63\u786e" };
    if (!adminEmails.length) return { ok: false, errMsg: "\u8bf7\u81f3\u5c11\u586b\u5199\u4e00\u4e2a\u7ba1\u7406\u5458\u6536\u4ef6\u90ae\u7bb1" };
  }

  return {
    ok: true,
    data: {
      enabled,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      fromEmail,
      fromName,
      adminEmails,
    },
  };
};

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeMailName = (value = "") => String(value || "").replace(/[\r\n<>]/g, "").trim();

const formatEmailFieldValue = (value) => {
  if (value === undefined || value === null || value === "") return "\u2014";
  if (Array.isArray(value)) {
    if (!value.length) return "\u2014";
    return value
      .map((item) => {
        if (item && typeof item === "object") return item.name || item.url || item.fileID || JSON.stringify(item);
        return String(item);
      })
      .join("\u3001");
  }
  if (value && typeof value === "object") {
    if (value.regionText || value.detail) return [value.regionText, value.detail].filter(Boolean).join(" ");
    if (value.name || value.url || value.fileID) return value.name || value.url || value.fileID;
    return JSON.stringify(value);
  }
  return String(value);
};

const buildEmailAnswerRows = (template = {}, answers = {}) => {
  const fields = Array.isArray(template.fields) ? template.fields : [];
  const rows = [];
  const usedKeys = new Set();
  fields.forEach((field) => {
    const key = field.id || field.key || field.name;
    if (!key) return;
    usedKeys.add(key);
    rows.push({ label: field.label || key, value: formatEmailFieldValue(answers[key]) });
  });
  Object.keys(answers || {}).forEach((key) => {
    if (!usedKeys.has(key)) rows.push({ label: key, value: formatEmailFieldValue(answers[key]) });
  });
  return rows;
};

const buildSubmissionEmail = ({ template = {}, submissionId = "", formNo = "", answers = {}, status = "pending", createTime = new Date() }) => {
  const summary = getSummaryFromItem({ answers, templateTitle: template.title });
  const rows = buildEmailAnswerRows(template, answers);
  const statusLabel = formatSubmissionStatus(status);
  const timeText = new Date(createTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const subject = `\u3010\u65b0\u8868\u5355\u63d0\u4ea4\u3011${template.title || "\u8868\u5355"}`.slice(0, 120);
  const textLines = [
    `\u6536\u5230\u65b0\u7684\u7528\u6237\u8868\u5355\u63d0\u4ea4`,
    `\u8868\u5355\uff1a${template.title || "\u8868\u5355"}`,
    `\u8868\u5355\u7f16\u53f7\uff1a${formNo || "\u2014"}`,
    `\u63d0\u4ea4\u7f16\u53f7\uff1a${submissionId}`,
    `\u63d0\u4ea4\u65f6\u95f4\uff1a${timeText}`,
    `\u72b6\u6001\uff1a${statusLabel}`,
    `\u63d0\u4ea4\u4eba\uff1a${summary.name || "\u2014"}`,
    `\u8054\u7cfb\u7535\u8bdd\uff1a${summary.phone || "\u2014"}`,
    "",
    "\u63d0\u4ea4\u5185\u5bb9\uff1a",
    ...rows.map((row) => `${row.label}\uff1a${row.value}`),
  ];
  const htmlRows = rows
    .map(
      (row) =>
        `<tr><td style="padding:10px 12px;border:1px solid #e5e7eb;background:#f8fafc;width:160px;color:#4b5563;">${escapeHtml(
          row.label
        )}</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${escapeHtml(row.value).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;line-height:1.6;">
    <h2 style="margin:0 0 16px;color:#0c3d7a;">\u6536\u5230\u65b0\u7684\u7528\u6237\u8868\u5355\u63d0\u4ea4</h2>
    <div style="margin-bottom:16px;color:#374151;">
      <div><b>\u8868\u5355\uff1a</b>${escapeHtml(template.title || "\u8868\u5355")}</div>
      <div><b>\u8868\u5355\u7f16\u53f7\uff1a</b>${escapeHtml(formNo || "\u2014")}</div>
      <div><b>\u63d0\u4ea4\u7f16\u53f7\uff1a</b>${escapeHtml(submissionId)}</div>
      <div><b>\u63d0\u4ea4\u65f6\u95f4\uff1a</b>${escapeHtml(timeText)}</div>
      <div><b>\u72b6\u6001\uff1a</b>${escapeHtml(statusLabel)}</div>
      <div><b>\u63d0\u4ea4\u4eba\uff1a</b>${escapeHtml(summary.name || "\u2014")}</div>
      <div><b>\u8054\u7cfb\u7535\u8bdd\uff1a</b>${escapeHtml(summary.phone || "\u2014")}</div>
    </div>
    <table style="border-collapse:collapse;width:100%;max-width:760px;font-size:14px;">${htmlRows}</table>
  </div>`;
  return { subject, text: textLines.join("\n"), html };
};

const createEmailTransporter = (config) =>
  nodemailer.createTransport({
    host: config.smtpHost,
    port: Number(config.smtpPort || 465),
    secure: config.smtpSecure !== false,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

const sendEmailWithConfig = async (config, mail) => {
  const transporter = createEmailTransporter(config);
  const fromName = safeMailName(config.fromName || "\u8868\u5355\u901a\u77e5");
  return transporter.sendMail({
    from: fromName ? `"${fromName}" <${config.fromEmail || config.smtpUser}>` : config.fromEmail || config.smtpUser,
    to: normalizeEmailList(config.adminEmails).join(","),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
};

const notifyAdminsByEmailOnSubmit = async (template, submissionId, answers, options = {}) => {
  try {
    const config = await getDefaultEmailConfig();
    if (!config || config.enabled === false) return { sent: 0, skipped: true };
    const validation = validateEmailConfig(config, config);
    if (!validation.ok) return { sent: 0, skipped: true, errMsg: validation.errMsg };
    const mail = buildSubmissionEmail({
      template,
      submissionId,
      formNo: options.formNo || "",
      answers,
      status: options.status || "pending",
      createTime: options.createTime || new Date(),
    });
    await sendEmailWithConfig(validation.data, mail);
    return { sent: normalizeEmailList(validation.data.adminEmails).length };
  } catch (e) {
    console.error("notifyAdminsByEmailOnSubmit failed", formatCloudError(e));
    return { sent: 0, failed: 1, errMsg: formatCloudError(e) };
  }
};

const getAdminEmailConfig = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;
  const config = await getDefaultEmailConfig();
  return { success: true, config: sanitizeEmailConfigForClient(config || { enabled: false }) };
};

const saveAdminEmailConfig = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(EMAIL_CONFIG_COLLECTION);
    const oldConfig = (await getDefaultEmailConfig()) || {};
    const { _id: oldConfigId, ...oldConfigData } = oldConfig;
    const validation = validateEmailConfig(event.data || {}, oldConfig);
    if (!validation.ok) return { success: false, errMsg: validation.errMsg };

    const data = {
      ...validation.data,
      updateTime: db.serverDate(),
      updatedBy: auth.openid,
    };

    try {
      await db.collection(EMAIL_CONFIG_COLLECTION).doc(EMAIL_DOC_ID).set({
        data: {
          ...oldConfigData,
          ...data,
          createTime: oldConfig.createTime || db.serverDate(),
        },
      });
    } catch (e) {
      await db.collection(EMAIL_CONFIG_COLLECTION).add({
        data: {
          ...data,
          createTime: db.serverDate(),
        },
      });
    }

    await logAdminAction(auth, "save_email_config", EMAIL_DOC_ID, {
      enabled: data.enabled,
      smtpHost: data.smtpHost,
      smtpUser: data.smtpUser,
      adminEmails: data.adminEmails,
    });
    return { success: true, config: sanitizeEmailConfigForClient(data) };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "保存邮箱配置失败" };
  }
};

const sendTestAdminEmail = async () => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const config = await getDefaultEmailConfig();
    const validation = validateEmailConfig(config || {}, config || {});
    if (!validation.ok) return { success: false, errMsg: validation.errMsg || "\u8bf7\u5148\u4fdd\u5b58\u90ae\u7bb1\u914d\u7f6e" };
    const mail = {
      subject: "\u3010\u6d4b\u8bd5\u90ae\u4ef6\u3011\u8868\u5355\u901a\u77e5\u90ae\u7bb1\u914d\u7f6e\u6210\u529f",
      text: "\u8fd9\u662f\u4e00\u5c01\u6d4b\u8bd5\u90ae\u4ef6\u3002\u5982\u679c\u4f60\u6536\u5230\u5b83\uff0c\u8bf4\u660e\u7ba1\u7406\u5458\u90ae\u7bb1\u901a\u77e5\u5df2\u914d\u7f6e\u6210\u529f\u3002",
      html: "<div style='font-family:Arial,sans-serif;line-height:1.7;'><h2>\u6d4b\u8bd5\u90ae\u4ef6\u53d1\u9001\u6210\u529f</h2><p>\u5982\u679c\u4f60\u6536\u5230\u5b83\uff0c\u8bf4\u660e\u7ba1\u7406\u5458\u90ae\u7bb1\u901a\u77e5\u5df2\u914d\u7f6e\u6210\u529f\u3002</p></div>",
    };
    await sendEmailWithConfig(validation.data, mail);
    await logAdminAction(auth, "send_test_email", EMAIL_DOC_ID, { adminEmails: validation.data.adminEmails });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatEmailError(e) || "测试邮件发送失败" };
  }
};

const notifySubmitterOnStatus = async (item, status) => {
  if (!item?.submitterNotifyAccepted) return;

  try {
    let settings = {};
    if (item.templateId) {
      const tpl = await db.collection(TEMPLATE_COLLECTION).doc(item.templateId).get();
      settings = tpl.data?.settings || {};
    }
    if (!settings.submitterNotifyEnabled || !settings.submitterNotifyTemplateId) return;

    const openid = item.openid || item._openid;
    if (!openid) return;

    const statusLabel = formatSubmissionStatus(status);
    const tmpl = await resolveSubscribeTemplate(settings.submitterNotifyTemplateId);
    if (!tmpl) return;

    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: tmpl.priTmplId,
      page: "pages/list/index",
      miniprogramState: "formal",
      data: buildSubscribeMessageDataAuto(tmpl.content, {
        name: item.templateTitle || "表单提交",
        detail: statusLabel,
      }),
    });

    if (settings.smsEnabled && settings.smsSubmitterEnabled) {
      const summary = getSummaryFromItem(item);
      if (summary.phone) {
        sendSmsWebhook(settings, {
          event: "status",
          phone: summary.phone,
          name: summary.name,
          templateTitle: item.templateTitle || "表单",
          content: `【${item.templateTitle || "表单"}】您的提交已${statusLabel}`,
          templateParams: [summary.name || "用户", statusLabel],
        }).catch(() => {});
      }
    }
  } catch (e) {
    /* ignore */
  }
};

const getDefaultNotifyConfig = async () => {
  try {
    await ensureCollection(NOTIFY_TEMPLATE_COLLECTION);
    const res = await db.collection(NOTIFY_TEMPLATE_COLLECTION).orderBy("createTime", "desc").limit(50).get();
    return (res.data || []).find((item) => item.enabled !== false) || null;
  } catch (e) {
    return null;
  }
};

const sendNotifyToSubscribedAdmins = async (payload) => {
  if (!payload?.templateId) return { sent: 0, failed: 0, errors: ["missing templateId"] };

  let admins = await db
    .collection(USER_COLLECTION)
    .where({ role: "admin", notifySubscribedIds: payload.templateId })
    .limit(20)
    .get();

  let adminList = admins.data || [];
  if (!adminList.length) {
    const legacy = await db
      .collection(USER_COLLECTION)
      .where({ role: "admin", notifySubscribed: true })
      .limit(20)
      .get();
    adminList = (legacy.data || []).filter(
      (admin) => !admin.notifySubscribedIds?.length || admin.notifySubscribedIds.includes(payload.templateId)
    );
  }

  if (!adminList.length) {
    return { sent: 0, failed: 0, errors: ["no subscribed admin"] };
  }

  const errors = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    adminList.map(async (admin) => {
      const openid = admin.openid || admin._openid;
      if (!openid) {
        failed += 1;
        errors.push("admin missing openid");
        return;
      }
      try {
        await sendAdminSubscribeNotify(openid, payload.templateId, payload);
        sent += 1;
      } catch (e) {
        failed += 1;
        errors.push(formatCloudError(e));
        console.error("subscribeMessage.send failed", openid, formatCloudError(e));
      }
    })
  );

  return { sent, failed, errors };
};

const buildAdminNotifyPayload = async (template, submissionId = "", answers = {}) => {
  const settings = template.settings || {};
  const defaultConfig = await getDefaultNotifyConfig();
  const mergedSettings = { ...settings };
  if (!mergedSettings.notifyConfigId && defaultConfig) {
    mergedSettings.notifyConfigId = defaultConfig._id;
  }

  const hasNotifySetup = !!(mergedSettings.notifyConfigId || mergedSettings.notifyTemplateId || defaultConfig);
  if (!hasNotifySetup) return null;
  if (settings.notifyEnabled === false && !mergedSettings.notifyConfigId && !defaultConfig) return null;

  const platformTemplate = await resolvePlatformTemplateForNotify(mergedSettings);
  if (!platformTemplate) return null;

  const notifyValues = extractNotifyValuesFromAnswers(answers, template, submissionId);
  return {
    templateId: platformTemplate.priTmplId,
    page: submissionId ? `pages/admin/detail/index?id=${submissionId}` : "pages/admin/index/index",
    data: buildSubscribeMessageDataAuto(platformTemplate.content, notifyValues),
  };
};

const notifyAdminsOnSubmit = async (template, submissionId, answers) => {
  try {
    const payload = await buildAdminNotifyPayload(template, submissionId, answers);
    if (!payload) return;
    await sendNotifyToSubscribedAdmins(payload);
  } catch (e) {
    console.error("notifyAdminsOnSubmit failed", formatCloudError(e));
  }
};

const notifyAdminsOnFormCreated = async (template, formId, creator) => {
  try {
    const defaultConfig = await getDefaultNotifyConfig();
    const settings = defaultConfig ? { notifyConfigId: defaultConfig._id } : {};
    const platformTemplate = await resolvePlatformTemplateForNotify(settings);
    if (!platformTemplate) return;

    const payload = {
      templateId: platformTemplate.priTmplId,
      page: `pages/admin/template/index?templateId=${formId}`,
      data: buildSubscribeMessageDataAuto(platformTemplate.content, {
        name: creator?.nickName || "管理员",
        company: template?.title || "新表单",
        number: String(formId).replace(/\D/g, "").slice(-8) || String(Date.now()).slice(-8),
        phone: creator?.phone || "",
        detail: "新建表单",
      }),
    };

    await sendNotifyToSubscribedAdmins(payload);
  } catch (e) {
    /* ignore */
  }
};

const sendAdminSubscribeNotify = async (openid, templateId, payload) =>
  cloud.openapi.subscribeMessage.send({
    touser: openid,
    templateId,
    page: payload.page,
    miniprogramState: "formal",
    data: payload.data,
  });

const getAdminNotifyStatus = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    const defaultConfig = await getDefaultNotifyConfig();
    const settings = defaultConfig ? { notifyConfigId: defaultConfig._id } : {};
    const platformTemplate = await resolvePlatformTemplateForNotify(settings);
    await ensureCollection(NOTIFY_TEMPLATE_COLLECTION);
    const configsRes = await db
      .collection(NOTIFY_TEMPLATE_COLLECTION)
      .orderBy("createTime", "desc")
      .limit(50)
      .get();
    const notifyConfigs = (configsRes.data || [])
      .filter((item) => item.enabled !== false).map((item) => ({
      _id: item._id,
      name: item.name || "",
      platformTemplateId: item.platformTemplateId || "",
      platformTemplateTitle: item.platformTemplateTitle || "",
    }));
    const priTmplId = platformTemplate?.priTmplId || "";
    const countRes = priTmplId
      ? await db
          .collection(USER_COLLECTION)
          .where({ role: "admin", notifySubscribedIds: priTmplId })
          .count()
      : await db.collection(USER_COLLECTION).where({ role: "admin", notifySubscribed: true }).count();

    const emailConfig = await getDefaultEmailConfig();
    const sanitizedEmailConfig = sanitizeEmailConfigForClient(emailConfig || { enabled: false });
    const emailReady = !!(
      sanitizedEmailConfig.enabled &&
      sanitizedEmailConfig.smtpHost &&
      sanitizedEmailConfig.smtpUser &&
      sanitizedEmailConfig.hasPassword &&
      normalizeEmailList(sanitizedEmailConfig.adminEmails).length
    );

    return {
      success: true,
      emailReady,
      emailConfig: sanitizedEmailConfig,
      notifyConfigId: defaultConfig?._id || "",
      notifyConfigs,
      platformTemplateId: priTmplId,
      platformTemplateTitle: platformTemplate?.title || platformTemplate?.configName || defaultConfig?.name || "",
      subscribed: userSubscribedToTemplate(auth.user, priTmplId),
      subscribedAdminCount: countRes.total || 0,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const sendTestAdminNotify = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { notifyConfigId, platformTemplateId } = event.data || {};
    const defaultConfig = notifyConfigId ? await getNotifyConfigById(notifyConfigId) : await getDefaultNotifyConfig();
    const settings = defaultConfig ? { notifyConfigId: defaultConfig._id } : {};
    if (platformTemplateId) settings.notifyTemplateId = platformTemplateId;

    const platformTemplate = await resolvePlatformTemplateForNotify(settings);
    if (!platformTemplate) {
      return { success: false, errMsg: "请先在订阅通知管理中添加模板" };
    }
    if (!userSubscribedToTemplate(auth.user, platformTemplate.priTmplId)) {
      return { success: false, errMsg: "请先授权该模板的订阅消息" };
    }

    const payload = {
      page: "pages/admin/forms/index",
      data: buildSubscribeMessageDataAuto(platformTemplate.content, {
        name: auth.user?.nickName || "测试管理员",
        company: "测试表单",
        number: String(Date.now()).slice(-8),
        phone: auth.user?.phone || "13800138000",
        detail: "新建表单测试",
      }),
    };

    try {
      await sendAdminSubscribeNotify(auth.user.openid || auth.openid, platformTemplate.priTmplId, payload);
      return { success: true };
    } catch (e) {
      return { success: false, errMsg: formatCloudError(e) || "发送失败，请检查模板配置" };
    }
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "发送失败" };
  }
};


const batchUpdateFormStatus = async (event) => {
  const auth = await requireAdmin("edit");
  if (!auth.ok) return auth.result;

  try {
    const { ids = [], status } = event.data || {};
    if (!ids.length) return { success: false, errMsg: "请选择记录" };
    if (ids.length > 100) return { success: false, errMsg: "单次最多处理 100 条" };
    if (!["pending", "processed", "rejected"].includes(status)) {
      return { success: false, errMsg: "状态无效" };
    }

    await Promise.all(
      ids.map(async (id) => {
        await db.collection(FORM_COLLECTION).doc(id).update({
          data: { status, updateTime: db.serverDate() },
        });
        if (["processed", "rejected"].includes(status)) {
          const doc = await db.collection(FORM_COLLECTION).doc(id).get();
          if (doc.data) notifySubmitterOnStatus(doc.data, status).catch(() => {});
        }
      })
    );

    await logAdminAction(auth, "batch_update_status", "", { ids, status, count: ids.length });
    return { success: true, count: ids.length };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "批量更新失败" };
  }
};

const batchDeleteFormSubmissions = async (event) => {
  const auth = await requireAdmin("delete");
  if (!auth.ok) return auth.result;

  try {
    const { ids = [] } = event.data || {};
    if (!ids.length) return { success: false, errMsg: "请选择记录" };
    if (ids.length > 100) return { success: false, errMsg: "单次最多删除 100 条" };

    await Promise.all(ids.map((id) => db.collection(FORM_COLLECTION).doc(id).remove()));
    await logAdminAction(auth, "batch_delete", "", { ids, count: ids.length });
    return { success: true, count: ids.length };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "批量删除失败" };
  }
};

const createPaymentOrder = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { submissionId } = event.data || {};
    if (!submissionId) return { success: false, errMsg: "\u7f3a\u5c11\u8ba2\u5355\u4fe1\u606f" };

    const doc = await db.collection(FORM_COLLECTION).doc(submissionId).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "\u8bb0\u5f55\u4e0d\u5b58\u5728" };
    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "\u65e0\u6743\u652f\u4ed8\u6b64\u8ba2\u5355" };
    }
    if (item.paymentStatus === "paid") return { success: false, errMsg: "\u5df2\u5b8c\u6210\u652f\u4ed8" };
    if (item.paymentStatus === "refunded" || item.refundStatus === "approved") {
      return { success: false, errMsg: "\u8be5\u8ba2\u5355\u5df2\u9000\u6b3e\uff0c\u65e0\u6cd5\u518d\u6b21\u652f\u4ed8" };
    }

    const amountYuan = Number(item.paymentAmount || 0);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
      return { success: false, errMsg: "\u8ba2\u5355\u91d1\u989d\u65e0\u6548\u6216\u65e0\u9700\u652f\u4ed8" };
    }

    let template = { settings: {}, title: item.templateTitle || "\u8868\u5355\u62a5\u540d" };
    try {
      template = await getTemplateById(item.templateId);
    } catch (e) {
      /* historical order can continue with its saved payment snapshot */
    }
    const subMchId = String(item.paymentMchIdSnapshot || template.settings?.paymentMchId || "").trim();
    if (!subMchId) {
      return { success: false, errMsg: "\u8be5\u8ba2\u5355\u7f3a\u5c11\u652f\u4ed8\u5546\u6237\u914d\u7f6e\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458" };
    }

    const totalFee = Math.round(amountYuan * 100);
    if (!Number.isSafeInteger(totalFee) || totalFee <= 0) {
      return { success: false, errMsg: "\u8ba2\u5355\u91d1\u989d\u65e0\u6548" };
    }
    const outTradeNo = `form_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const wxContext = cloud.getWXContext();
    const clientIp = wxContext.CLIENTIP || wxContext.CLIENTIPV6 || "127.0.0.1";
    const payRes = await cloud.cloudPay.unifiedOrder({
      body: (template.title || item.templateTitle || "\u8868\u5355\u62a5\u540d").slice(0, 40),
      outTradeNo,
      spbillCreateIp: String(clientIp).slice(0, 64),
      subMchId,
      totalFee,
      envId: cloud.DYNAMIC_CURRENT_ENV,
      functionName: "quickstartFunctions",
    });

    await db.collection(FORM_COLLECTION).doc(submissionId).update({
      data: {
        outTradeNo,
        paymentStatus: "pending",
        paymentMchIdSnapshot: subMchId,
        paymentTotalFee: totalFee,
        updateTime: db.serverDate(),
      },
    });
    return { success: true, payment: payRes.payment };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "\u521b\u5efa\u652f\u4ed8\u8ba2\u5355\u5931\u8d25" };
  }
};

const verifyCheckin = async (event) => {
  const auth = await requireAdmin("checkin");
  if (!auth.ok) return auth.result;

  try {
    const { checkCode } = event.data || {};
    const code = String(checkCode || "").trim().toUpperCase();
    if (!code) return { success: false, errMsg: "请输入签到码" };

    const result = await db.collection(FORM_COLLECTION).where({ checkCode: code }).limit(1).get();
    const item = result.data?.[0];
    if (!item) return { success: false, errMsg: "签到码无效" };
    if (item.checkedIn) {
    return {
      success: false,
        errMsg: "该凭证已签到",
        alreadyCheckedIn: true,
        submission: item,
      };
    }

    const _ = db.command;
    const updateRes = await db
      .collection(FORM_COLLECTION)
      .where({ _id: item._id, checkedIn: _.neq(true) })
      .update({
        data: {
          checkedIn: true,
          checkinTime: db.serverDate(),
          updateTime: db.serverDate(),
        },
      });
    if (!updateRes.stats?.updated) {
      return {
        success: false,
        errMsg: "该凭证已签到",
        alreadyCheckedIn: true,
        submission: item,
      };
    }

    const summary = getSummaryFromItem(item);
    await logAdminAction(auth, "checkin", item._id, { checkCode: code, name: summary.name });

    const updated = await db.collection(FORM_COLLECTION).doc(item._id).get();
    return { success: true, submission: updated.data };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "签到失败" };
  }
};

const requestRefund = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { submissionId, reason = "" } = event.data || {};
    if (!submissionId) return { success: false, errMsg: "缺少订单信息" };

    const doc = await db.collection(FORM_COLLECTION).doc(submissionId).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "记录不存在" };
    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "无权操作此订单" };
    }
    if (item.paymentStatus !== "paid") {
      return { success: false, errMsg: "仅已支付订单可申请退款" };
    }
    if (item.refundStatus === "pending") {
      return { success: false, errMsg: "退款申请处理中" };
    }
    if (item.refundStatus === "approved") {
      return { success: false, errMsg: "该订单已退款" };
    }

    await db.collection(FORM_COLLECTION).doc(submissionId).update({
      data: {
        refundStatus: "pending",
        refundReason: String(reason).trim().slice(0, 200),
        refundRequestTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "申请失败" };
  }
};

const processRefund = async (event) => {
  const auth = await requireAdmin("edit");
  if (!auth.ok) return auth.result;

  try {
    const { id, action = "approve", adminNote = "" } = event.data || {};
    if (!id) return { success: false, errMsg: "\u7f3a\u5c11\u8bb0\u5f55 ID" };
    if (!['approve', 'reject'].includes(action)) {
      return { success: false, errMsg: "\u9000\u6b3e\u5904\u7406\u52a8\u4f5c\u65e0\u6548" };
    }

    const doc = await db.collection(FORM_COLLECTION).doc(id).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "\u8bb0\u5f55\u4e0d\u5b58\u5728" };
    if (item.refundStatus !== "pending") {
      return { success: false, errMsg: "\u5f53\u524d\u65e0\u5f85\u5904\u7406\u9000\u6b3e\u7533\u8bf7" };
    }

    if (action === "reject") {
      const _ = db.command;
      const updateRes = await db.collection(FORM_COLLECTION).where({ _id: id, refundStatus: "pending" }).update({
        data: {
          refundStatus: "rejected",
          refundAdminNote: String(adminNote).trim().slice(0, 200),
          refundProcessTime: db.serverDate(),
          updateTime: db.serverDate(),
        },
      });
      if (!updateRes.stats?.updated) return { success: false, errMsg: "\u9000\u6b3e\u72b6\u6001\u5df2\u53d8\u66f4\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5" };
      await logAdminAction(auth, "refund_reject", id, { adminNote });
      return { success: true, refundStatus: "rejected" };
    }

    if (item.paymentStatus !== "paid") {
      return { success: false, errMsg: "\u53ea\u80fd\u9000\u8fd8\u5df2\u652f\u4ed8\u4e14\u672a\u9000\u6b3e\u7684\u8ba2\u5355" };
    }
    const outTradeNo = String(item.outTradeNo || "").trim();
    const totalFee = Number.isSafeInteger(Number(item.paymentTotalFee)) && Number(item.paymentTotalFee) > 0
      ? Number(item.paymentTotalFee)
      : Math.round(Number(item.paymentAmount || 0) * 100);
    if (!outTradeNo || !Number.isSafeInteger(totalFee) || totalFee <= 0) {
      return { success: false, errMsg: "\u8ba2\u5355\u7f3a\u5c11\u6709\u6548\u7684\u652f\u4ed8\u5355\u53f7\u6216\u91d1\u989d\uff0c\u4e0d\u80fd\u6807\u8bb0\u4e3a\u5df2\u9000\u6b3e" };
    }

    let template = { settings: {} };
    try {
      template = await getTemplateById(item.templateId);
    } catch (e) {
      /* historical order can continue with its saved merchant snapshot */
    }
    const subMchId = String(item.paymentMchIdSnapshot || template.settings?.paymentMchId || "").trim();
    if (!subMchId) {
      return { success: false, errMsg: "\u8ba2\u5355\u7f3a\u5c11\u652f\u4ed8\u5546\u6237\u53f7\uff0c\u4e0d\u80fd\u8c03\u7528\u9000\u6b3e\u63a5\u53e3" };
    }

    const refundOutTradeNo = item.refundOutTradeNo || `rf_${crypto
      .createHash("sha256")
      .update(`${id}:${outTradeNo}`)
      .digest("hex")
      .slice(0, 28)}`;
    try {
      await cloud.cloudPay.refund({
        outTradeNo,
        outRefundNo: refundOutTradeNo,
        totalFee,
        refundFee: totalFee,
        envId: cloud.DYNAMIC_CURRENT_ENV,
        subMchId,
      });
    } catch (payErr) {
      return { success: false, errMsg: formatCloudError(payErr) || "\u5fae\u4fe1\u9000\u6b3e\u63a5\u53e3\u8c03\u7528\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u652f\u4ed8\u914d\u7f6e" };
    }

    const updateRes = await db.collection(FORM_COLLECTION).where({ _id: id, refundStatus: "pending", paymentStatus: "paid" }).update({
      data: {
        refundStatus: "approved",
        paymentStatus: "refunded",
        status: "rejected",
        refundOutTradeNo,
        paymentMchIdSnapshot: subMchId,
        paymentTotalFee: totalFee,
        refundAdminNote: String(adminNote).trim().slice(0, 200),
        refundProcessTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    if (!updateRes.stats?.updated) {
      return { success: false, errMsg: "\u9000\u6b3e\u5df2\u53d1\u8d77\uff0c\u4f46\u672c\u5730\u72b6\u6001\u5df2\u53d8\u66f4\uff0c\u8bf7\u6838\u5bf9\u5fae\u4fe1\u652f\u4ed8\u8ba2\u5355" };
    }
    await logAdminAction(auth, "refund_approve", id, { adminNote, amount: item.paymentAmount, refundOutTradeNo });
    return { success: true, refundStatus: "approved" };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "\u9000\u6b3e\u5904\u7406\u5931\u8d25" };
  }
};

const exportAttachments = async (event) => {
  const auth = await requireAdmin("export");
  if (!auth.ok) return auth.result;

  try {
    const {
      status = "all",
      keyword = "",
      dateFrom = "",
      dateTo = "",
      format = "json",
      templateId = "",
      phone = "",
      typeValue = "",
      fieldId = "",
    } = event.data || {};
    const template = templateId ? await getTemplateById(templateId) : await ensureDefaultTemplate();
    const resolvedTemplateId = template._id || templateId;
    const query = buildSubmissionQuery({ status, templateId: resolvedTemplateId, dateFrom, dateTo });
    const rows = await fetchSubmissionRows(query, MAX_EXPORT_ROWS);
    const data = filterSubmissions(rows, {
      keyword,
      phone,
      typeValue,
      fieldId,
      templateId: resolvedTemplateId,
    });

    const fileFields = (template.fields || []).filter((field) =>
      ["image", "file", "signature"].includes(field.type)
    );
    if (!fileFields.length) {
      return { success: false, errMsg: "\u8868\u5355\u4e2d\u6ca1\u6709\u56fe\u7247/\u6587\u4ef6/\u7b7e\u540d\u5b57\u6bb5" };
    }

    const manifest = [];
    const fileIdSet = new Set();
    data.forEach((item) => {
      const summary = getSummaryFromItem(item);
      fileFields.forEach((field) => {
        let files = item.answers?.[field.id];
        if (field.type === "signature" && typeof files === "string" && files) files = [files];
        if (!Array.isArray(files)) return;
        files.forEach((fileID, index) => {
          if (!fileID || fileIdSet.has(fileID)) return;
          fileIdSet.add(fileID);
          manifest.push({
            submissionId: item._id,
            submitter: summary.name || "",
            fieldId: field.id,
            fieldLabel: field.label || field.id,
            fileID,
            index,
          });
        });
      });
    });

    if (!manifest.length) return { success: false, errMsg: "\u672a\u627e\u5230\u53ef\u5bfc\u51fa\u7684\u9644\u4ef6" };

    const fileList = manifest.map((item) => item.fileID);
    const batchSize = 50;
    const urlMap = {};
    for (let i = 0; i < fileList.length; i += batchSize) {
      const batch = fileList.slice(i, i + batchSize);
      const urlRes = await cloud.getTempFileURL({ fileList: batch });
      (urlRes.fileList || []).forEach((file) => {
        urlMap[file.fileID] = file.tempFileURL || "";
      });
    }
    manifest.forEach((item) => {
      item.downloadUrl = urlMap[item.fileID] || "";
    });

    if (format === "zip") {
      let JSZip;
      try {
        JSZip = require("jszip");
      } catch (e) {
        return { success: false, errMsg: "ZIP \u529f\u80fd\u9700\u91cd\u65b0\u90e8\u7f72\u4e91\u51fd\u6570\u5e76\u5b89\u88c5 jszip \u4f9d\u8d56" };
      }
      const zipLimit = 80;
      const zipItems = manifest.slice(0, zipLimit);
      const zip = new JSZip();
      for (let i = 0; i < zipItems.length; i++) {
        const item = zipItems[i];
        try {
          const download = await cloud.downloadFile({ fileID: item.fileID });
          const ext = item.fileID.includes(".") ? item.fileID.slice(item.fileID.lastIndexOf(".")) : ".bin";
          const safeName = `${item.submitter || "user"}_${item.fieldId}_${item.index}${ext}`.replace(/[\\/:*?"<>|]/g, "_");
          zip.file(safeName, download.fileContent);
        } catch (e) {
          /* skip broken file */
        }
      }
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const upload = await cloud.uploadFile({
        cloudPath: `exports/attachments-${Date.now()}.zip`,
        fileContent: zipBuffer,
      });
      await logAdminAction(auth, "export_attachments_zip", "", { count: zipItems.length, templateId: resolvedTemplateId });
      return {
        success: true,
        fileID: upload.fileID,
        count: zipItems.length,
        format: "zip",
        truncated: manifest.length > zipLimit,
      };
    }

    const content = JSON.stringify({ exportedAt: new Date().toISOString(), count: manifest.length, files: manifest }, null, 2);
    const upload = await cloud.uploadFile({
      cloudPath: `exports/attachments-${Date.now()}.json`,
      fileContent: Buffer.from(content, "utf8"),
    });
    await logAdminAction(auth, "export_attachments", "", { count: manifest.length, templateId: resolvedTemplateId });
    return { success: true, fileID: upload.fileID, count: manifest.length, files: manifest.slice(0, 20) };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || e.message || "\u9644\u4ef6\u5bfc\u51fa\u5931\u8d25" };
  }
};

const listFormTemplates = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(TEMPLATE_COLLECTION);
    const result = await db.collection(TEMPLATE_COLLECTION).orderBy("updateTime", "desc").limit(50).get();
    const list = result.data || [];
    const counts = await Promise.all(
      list.map((tpl) =>
        db.collection(FORM_COLLECTION).where({ templateId: tpl._id }).count().catch(() => ({ total: 0 }))
      )
    );
    return {
      success: true,
      list: list.map((tpl, i) => ({
        _id: tpl._id,
        title: tpl.title,
        description: tpl.description,
        isDefault: !!tpl.isDefault,
        enabled: tpl.enabled !== false,
        updateTime: tpl.updateTime,
        submissionCount: counts[i]?.total || 0,
      })),
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const createFormTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { title = "新表单", copyFromId } = event.data || {};
    let payload = {
      ...DEFAULT_TEMPLATE,
      title: String(title).trim() || "新表单",
      isDefault: false,
      enabled: true,
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
    };

    if (copyFromId) {
      const doc = await db.collection(TEMPLATE_COLLECTION).doc(copyFromId).get();
      if (doc.data) {
        const { _id, ...rest } = doc.data;
        payload = {
          ...rest,
          fields: (rest.fields || []).filter((field) => field && field.type !== "location"),
          title: String(title).trim() || `${rest.title || "表单"} 副本`,
          isDefault: false,
          enabled: true,
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
        };
      }
    }

    const addResult = await addDocument(TEMPLATE_COLLECTION, payload);
    const created = await db.collection(TEMPLATE_COLLECTION).doc(addResult._id).get();
    await logAdminAction(auth, "create_template", addResult._id, { title: payload.title });
    notifyAdminsOnFormCreated(created.data, addResult._id, auth.user).catch(() => {});
    return { success: true, template: created.data };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "创建失败" };
  }
};

const deleteFormTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { templateId } = event.data || {};
    if (!templateId) return { success: false, errMsg: "缺少表单 ID" };

    await ensureCollection(TEMPLATE_COLLECTION);
    await ensureCollection(FORM_COLLECTION);
    const template = await getTemplateById(templateId);
    if (template.isDefault) {
      return { success: false, errMsg: "默认表单不能删除，请先设置其他表单为默认表单" };
    }

    const submissionCount = await db.collection(FORM_COLLECTION).where({ templateId: template._id }).count();
    if (Number(submissionCount.total || 0) > 0) {
      return { success: false, errMsg: "该表单已有提交记录，不能删除，请改为停用" };
    }

    await db.collection(TEMPLATE_COLLECTION).doc(template._id).remove();
    await logAdminAction(auth, "delete_form_template", template._id, { title: template.title || "" });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "删除失败" };
  }
};

const setDefaultFormTemplate = async (event) => {
  const auth = await requireAdmin("config");
  if (!auth.ok) return auth.result;

  try {
    const { templateId } = event.data || {};
    if (!templateId) return { success: false, errMsg: "缺少表单 ID" };

    const doc = await db.collection(TEMPLATE_COLLECTION).doc(templateId).get();
    if (!doc.data) return { success: false, errMsg: "表单不存在" };

    const existing = await db.collection(TEMPLATE_COLLECTION).where({ isDefault: true }).get();
    await Promise.all(
      (existing.data || []).map((item) =>
        db.collection(TEMPLATE_COLLECTION).doc(item._id).update({
          data: { isDefault: false, updateTime: db.serverDate() },
        })
      )
    );

    await db.collection(TEMPLATE_COLLECTION).doc(templateId).update({
      data: { isDefault: true, updateTime: db.serverDate() },
    });
    await logAdminAction(auth, "set_default_template", templateId, { title: doc.data.title });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "设置失败" };
  }
};

const sendDailyDigest = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;
  return pushDailyDigestCore({ source: "manual", adminOpenid: auth.openid });
};

const pushDailyDigestCore = async ({ source = "manual", adminOpenid = "" } = {}) => {
  try {
    const template = await ensureDefaultTemplate();
    const settings = template.settings || {};

    if (source === "scheduled" && !settings.autoDigestEnabled) {
      return { success: true, skipped: true, reason: "自动日报未开启" };
    }

    const now = new Date();
    const targetHour = Number(settings.digestHour ?? 9);
    if (source === "scheduled" && now.getHours() !== targetHour) {
      return { success: true, skipped: true, reason: "非推送时段" };
    }

    const todayKey = formatDateKey(now);
    if (source === "scheduled" && settings.lastDigestDate === todayKey) {
      return { success: true, skipped: true, reason: "今日已推送" };
    }

    const analytics = await getFormAnalyticsInternal();
    if (!analytics.success) return analytics;

    const platformTemplate = await resolvePlatformTemplateForNotify(settings);
    if (!platformTemplate) {
      return { success: false, errMsg: "请先在订阅通知管理中添加模板" };
    }

    const admins = await db
      .collection(USER_COLLECTION)
      .where({ role: "admin", notifySubscribedIds: platformTemplate.priTmplId })
      .limit(20)
      .get();

    let adminList = admins.data || [];
    if (!adminList.length) {
      const legacy = await db
        .collection(USER_COLLECTION)
        .where({ role: "admin", notifySubscribed: true })
        .limit(20)
        .get();
      adminList = legacy.data || [];
    }

    if (!adminList.length) {
      return { success: false, errMsg: "暂无已授权该模板的管理员，请在订阅通知管理中授权" };
    }

    const digest = analytics.dailyDigest || "今日暂无数据";
    const digestData = buildSubscribeMessageDataAuto(platformTemplate.content, {
      name: "每日运营摘要",
      detail: digest.replace(/\n/g, " "),
    });

    await Promise.all(
      adminList.map((admin) =>
        cloud.openapi.subscribeMessage
          .send({
            touser: admin.openid,
            templateId: platformTemplate.priTmplId,
            page: "pages/admin/stats/index",
            miniprogramState: "formal",
            data: digestData,
          })
          .catch(() => null)
      )
    );

    if (settings.smsEnabled && settings.smsDigestEnabled) {
      sendSmsWebhook(settings, {
        event: "digest",
        templateTitle: template.title,
        content: digest.replace(/\n/g, " "),
        templateParams: [String(analytics.stats?.todayCount || 0), String(analytics.stats?.pending || 0)],
      }).catch(() => {});
    }

    if (source === "scheduled") {
      await db.collection(TEMPLATE_COLLECTION).doc(template._id).update({
        data: {
          "settings.lastDigestDate": todayKey,
          updateTime: db.serverDate(),
        },
      });
    }

    if (adminOpenid) {
      await logAudit({
        action: source === "scheduled" ? "auto_daily_digest" : "send_daily_digest",
        targetId: "",
        detail: { digest, source },
        adminOpenid,
        adminName: source === "scheduled" ? "定时任务" : "管理员",
      });
    }

    return { success: true, sent: (admins.data || []).length, digest, source };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "推送失败" };
  }
};

const getFormAnalyticsInternal = async () => {
  try {
    await ensureCollection(FORM_COLLECTION);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);

    const [total, pending, processed, data, refundPendingCount] = await Promise.all([
      db.collection(FORM_COLLECTION).count(),
      db.collection(FORM_COLLECTION).where({ status: "pending" }).count(),
      db.collection(FORM_COLLECTION).where({ status: "processed" }).count(),
      fetchSubmissionRows(buildSubmissionQuery({ dateFrom: weekStart }), MAX_FILTER_SCAN_ROWS),
      db.collection(FORM_COLLECTION).where({ refundStatus: "pending" }).count(),
    ]);

    let todayCount = 0;
    data.forEach((item) => {
      const time = item.createTime ? new Date(item.createTime) : null;
      if (time && time >= todayStart) todayCount += 1;
    });
    const weekCount = data.length;
    const template = await ensureDefaultTemplate();
    const anomalies = detectAnomalies(data, Number(template.settings?.anomalyThreshold || 3));
    const refundPending = Number(refundPendingCount.total || 0);
    const dailyDigest = [
      `\u3010\u8868\u5355\u65e5\u62a5 ${formatDateKey(now)}\u3011`,
      `\u4eca\u65e5\u63d0\u4ea4 ${todayCount} \u6761\uff0c\u5f85\u5904\u7406 ${pending.total} \u6761`,
      `\u8fd17\u65e5 ${weekCount} \u6761\uff0c\u5f02\u5e38 ${anomalies.length} \u9879`,
      refundPending ? `\u5f85\u9000\u6b3e ${refundPending} \u6761` : "",
    ].filter(Boolean).join("\n");

    return {
      success: true,
      stats: {
        total: total.total,
        pending: pending.total,
        processed: processed.total,
        todayCount,
        weekCount,
        refundPending,
      },
      dailyDigest,
      anomalies,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || e.message || "\u7edf\u8ba1\u5931\u8d25" };
  }
};

const runScheduledDailyDigest = async () => pushDailyDigestCore({ source: "scheduled" });

const collectBackupFields = async (submissions, defaultTemplate) => {
  const fieldMap = new Map();
  (defaultTemplate.fields || []).forEach((field) => fieldMap.set(field.id, field));
  const templateIds = [...new Set(submissions.map((item) => item.templateId).filter(Boolean))];
  await Promise.all(
    templateIds.map(async (templateId) => {
      if (templateId === defaultTemplate._id) return;
      try {
        const doc = await db.collection(TEMPLATE_COLLECTION).doc(templateId).get();
        (doc.data?.fields || []).forEach((field) => {
          if (!fieldMap.has(field.id)) fieldMap.set(field.id, field);
        });
      } catch (e) {
        /* ignore missing template */
      }
    })
  );
  return Array.from(fieldMap.values());
};

const backupFormDataCore = async ({ source = "manual", adminOpenid = "" } = {}) => {
  try {
    const template = await ensureDefaultTemplate();
    const settings = template.settings || {};

    if (source === "scheduled" && !settings.autoBackupEnabled) {
      return { success: true, skipped: true, reason: "自动备份未开启" };
    }

    const totalRes = await db.collection(FORM_COLLECTION).count();
    const totalInDb = totalRes.total || 0;
    const MAX_BACKUP = 5000;
    const PAGE_SIZE = 1000;
    const submissions = [];
    let skip = 0;
    while (submissions.length < MAX_BACKUP) {
      const batch = await db
        .collection(FORM_COLLECTION)
        .orderBy("createTime", "desc")
        .skip(skip)
        .limit(PAGE_SIZE)
        .get();
      const rows = batch.data || [];
      if (!rows.length) break;
      submissions.push(...rows);
      skip += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
    const truncated = totalInDb > submissions.length;
    const payload = {
      exportedAt: new Date().toISOString(),
      count: submissions.length,
      totalInDb,
      truncated,
      template: {
        _id: template._id,
        title: template.title,
        fields: template.fields || [],
      },
      submissions,
    };

    const timestamp = Date.now();
    const fields = await collectBackupFields(submissions, template);
    const [jsonUpload, excelUpload] = await Promise.all([
      cloud.uploadFile({
        cloudPath: `backups/backup-${timestamp}.json`,
        fileContent: Buffer.from(JSON.stringify(payload), "utf8"),
      }),
      cloud.uploadFile({
        cloudPath: `backups/backup-${timestamp}.xlsx`,
        fileContent: buildBackupExcel(submissions, fields),
      }),
    ]);

    await ensureCollection(BACKUP_COLLECTION);
    await db.collection(BACKUP_COLLECTION).add({
      data: {
        fileID: jsonUpload.fileID,
        excelFileID: excelUpload.fileID,
        count: submissions.length,
        totalInDb,
        truncated,
        source,
        createTime: db.serverDate(),
      },
    });

    await db.collection(TEMPLATE_COLLECTION).doc(template._id).update({
      data: {
        "settings.lastBackupAt": db.serverDate(),
        "settings.lastBackupFileId": jsonUpload.fileID,
        "settings.lastBackupExcelFileId": excelUpload.fileID,
        updateTime: db.serverDate(),
      },
    });

    if (adminOpenid) {
      await logAudit({
        action: source === "scheduled" ? "auto_backup" : "backup_data",
        targetId: jsonUpload.fileID,
        detail: { count: submissions.length, totalInDb, truncated, source, excelFileID: excelUpload.fileID },
        adminOpenid,
        adminName: source === "scheduled" ? "定时任务" : "管理员",
      });
    }

    return {
      success: true,
      fileID: jsonUpload.fileID,
      excelFileID: excelUpload.fileID,
      count: submissions.length,
      totalInDb,
      truncated,
      source,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "备份失败" };
  }
};

const backupFormData = async (event) => {
  const auth = await requireAdmin("export");
  if (!auth.ok) return auth.result;
  return backupFormDataCore({ source: "manual", adminOpenid: auth.openid });
};

const listBackups = async () => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(BACKUP_COLLECTION);
    const result = await db.collection(BACKUP_COLLECTION).orderBy("createTime", "desc").limit(20).get();
    return { success: true, list: result.data || [] };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const getFileTempUrl = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    const fileID = String(event.data?.fileID || "").trim();
    if (!fileID) return { success: false, errMsg: "\u7f3a\u5c11\u6587\u4ef6 ID" };
    if (!fileID.startsWith("cloud://")) {
      return { success: false, errMsg: "\u6587\u4ef6 ID \u683c\u5f0f\u65e0\u6548" };
    }

    await ensureCollection(BACKUP_COLLECTION);
    const _ = db.command;
    const backup = await db
      .collection(BACKUP_COLLECTION)
      .where(_.or([{ fileID }, { excelFileID: fileID }]))
      .limit(1)
      .get();
    if (!(backup.data || []).length) {
      return { success: false, errMsg: "\u8be5\u6587\u4ef6\u4e0d\u5728\u5907\u4efd\u8bb0\u5f55\u4e2d" };
    }

    const urlRes = await cloud.getTempFileURL({ fileList: [fileID] });
    const downloadUrl = urlRes.fileList?.[0]?.tempFileURL || "";
    if (!downloadUrl) return { success: false, errMsg: "\u83b7\u53d6\u4e0b\u8f7d\u94fe\u63a5\u5931\u8d25" };
    return { success: true, downloadUrl };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "\u83b7\u53d6\u5931\u8d25" };
  }
};

const listPublicForms = async () => {
  try {
    await ensureCollection(TEMPLATE_COLLECTION);
    const result = await db.collection(TEMPLATE_COLLECTION).orderBy("updateTime", "desc").limit(100).get();
    const homeRules = [
      { key: "special", keys: ["专精代为", "专精特新", "专精"] },
      { key: "tender", keys: ["标书代为", "标书代写", "标书代办", "代写标书", "标书", "投标", "招标文件"] },
      { key: "declare", keys: ["证书委托", "证书"] },
      { key: "high", keys: ["高新代为", "高新代办", "高新"] },
      { key: "talent", keys: ["人才合作", "人才"] },
      { key: "other", keys: ["其他需求"] },
    ];
    const inferHomeServiceKey = (title) => {
      const text = String(title || "").replace(/\s+/g, "").trim();
      if (!text) return "";
      let bestKey = "";
      let bestLen = 0;
      homeRules.forEach((rule) => {
        (rule.keys || []).forEach((word) => {
          const needle = String(word || "").replace(/\s+/g, "");
          if (needle && text.includes(needle) && needle.length > bestLen) {
            bestKey = rule.key;
            bestLen = needle.length;
          }
        });
      });
      return bestKey;
    };

    const writes = [];
    const list = (result.data || [])
      .filter((t) => t.enabled !== false)
      .map((t) => {
        let homeServiceKey = String(t.settings?.homeServiceKey || "").trim();
        if (!homeServiceKey) {
          homeServiceKey = inferHomeServiceKey(t.title);
          // 首次命中后写入，之后改名仍能按入口绑定
          if (homeServiceKey) {
            writes.push(
              db
                .collection(TEMPLATE_COLLECTION)
                .doc(t._id)
                .update({
                  data: {
                    "settings.homeServiceKey": homeServiceKey,
                  },
                })
            );
          }
        }
        return {
          _id: t._id,
          title: t.title || "未命名表单",
          description: t.description || "",
          isDefault: !!t.isDefault,
          themeColor: t.settings?.themeColor || "#1e293b",
          coverImage: t.settings?.coverImage || "",
          homeServiceKey,
        };
      });
    if (writes.length) {
      await Promise.all(writes.map((p) => p.catch(() => null)));
    }
    return { success: true, list };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const runScheduledBackup = async () => backupFormDataCore({ source: "scheduled" });

const getMyVoucher = async (event) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.result;

  try {
    const { submissionId } = event.data || {};
    if (!submissionId) return { success: false, errMsg: "\u7f3a\u5c11\u8bb0\u5f55 ID" };

    const doc = await db.collection(FORM_COLLECTION).doc(submissionId).get();
    const item = doc.data;
    if (!item) return { success: false, errMsg: "\u8bb0\u5f55\u4e0d\u5b58\u5728" };
    if (!ownsSubmission(item, auth)) {
      return { success: false, errMsg: "\u65e0\u6743\u67e5\u770b\u6b64\u51ed\u8bc1" };
    }
    if (!item.checkCode) return { success: false, errMsg: "\u8be5\u8bb0\u5f55\u6682\u65e0\u7535\u5b50\u51ed\u8bc1" };

    let template = { title: item.templateTitle || "\u6d3b\u52a8\u51ed\u8bc1" };
    try {
      template = await getTemplateById(item.templateId);
    } catch (e) {
      /* deleted templates do not invalidate issued vouchers */
    }
    const summary = getSummaryFromItem(item);
    const title = template.title || item.templateTitle || "\u6d3b\u52a8\u51ed\u8bc1";
    return {
      success: true,
      voucher: {
        checkCode: item.checkCode,
        checkedIn: !!item.checkedIn,
        title,
        submitter: summary.name || "",
        createTime: item.createTime,
        templateTitle: title,
      },
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "\u52a0\u8f7d\u51ed\u8bc1\u5931\u8d25" };
  }
};

const handlePayCallback = async (event) => {
  try {
    const { returnCode, resultCode, outTradeNo, transactionId } = event;
    if (returnCode !== "SUCCESS" || resultCode !== "SUCCESS" || !outTradeNo) {
      return { errcode: 0, errmsg: "SUCCESS" };
    }

    const result = await db.collection(FORM_COLLECTION).where({ outTradeNo: String(outTradeNo) }).limit(1).get();
    const item = result.data?.[0];
    if (!item) return { errcode: 0, errmsg: "SUCCESS" };
    if (item.paymentStatus === "paid" || item.paymentStatus === "refunded") {
      return { errcode: 0, errmsg: "SUCCESS" };
    }

    const callbackTotalFee = Number(event.totalFee);
    const expectedTotalFee = Number(item.paymentTotalFee || Math.round(Number(item.paymentAmount || 0) * 100));
    if (Number.isFinite(callbackTotalFee) && callbackTotalFee > 0 && callbackTotalFee !== expectedTotalFee) {
      return { errcode: -1, errmsg: "PAYMENT_AMOUNT_MISMATCH" };
    }

    const _ = db.command;
    const updateRes = await db.collection(FORM_COLLECTION).where({
      _id: item._id,
      outTradeNo: String(outTradeNo),
      paymentStatus: _.in(["unpaid", "pending"]),
    }).update({
      data: {
        paymentStatus: "paid",
        status: "pending",
        paymentTotalFee: expectedTotalFee,
        transactionId: transactionId || item.transactionId || "",
        paidAt: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    if (!updateRes.stats?.updated) return { errcode: 0, errmsg: "SUCCESS" };

    const submissionId = item._id;
    const updatedDoc = await db.collection(FORM_COLLECTION).doc(submissionId).get();
    const updatedItem = updatedDoc.data || item;
    let template = { settings: {}, title: updatedItem.templateTitle || "\u8868\u5355" };
    try {
      template = await getTemplateById(updatedItem.templateId);
    } catch (e) {
      /* missing template must not break payment acknowledgement */
    }
    notifyAdminsOnSubmit(template, submissionId, updatedItem.answers || {}).catch(() => {});

    const checkinEnabled = updatedItem.checkinEnabledSnapshot ?? !!template.settings?.checkinEnabled;
    if (checkinEnabled && !updatedItem.checkCode) {
      const checkCode = await generateCheckCode();
      await db.collection(FORM_COLLECTION).doc(submissionId).update({
        data: { checkCode, updateTime: db.serverDate() },
      });
    }
    return { errcode: 0, errmsg: "SUCCESS" };
  } catch (e) {
    return { errcode: -1, errmsg: String(e.message || e) };
  }
};

const getAuditLogs = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(AUDIT_COLLECTION);
    const { page = 1, pageSize = 30 } = event.data || {};
    const safePageSize = Math.min(Math.max(Number(pageSize) || 30, 1), 100);
    const skip = Math.max(0, (Number(page) - 1) * safePageSize);
    const result = await db
      .collection(AUDIT_COLLECTION)
      .orderBy("createTime", "desc")
      .skip(skip)
      .limit(safePageSize)
      .get();

    return { success: true, list: result.data || [] };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载失败" };
  }
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listUsers = async (event) => {
  const auth = await requireAdmin("read");
  if (!auth.ok) return auth.result;

  try {
    await ensureCollection(USER_COLLECTION);
    const {
      page = 1,
      pageSize = 20,
      keyword = "",
      role = "",
    } = event.data || {};
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (safePage - 1) * safePageSize;
    const keywordText = String(keyword || "").trim();
    const roleFilter = String(role || "").trim();
    const _ = db.command;

    const clauses = [];
    if (roleFilter === "admin" || roleFilter === "user") {
      clauses.push({ role: roleFilter });
    }
    if (keywordText) {
      const reg = db.RegExp({
        regexp: escapeRegExp(keywordText),
        options: "i",
      });
      clauses.push(
        _.or([
          { nickName: reg },
          { phone: reg },
          { email: reg },
          { openid: reg },
          { _openid: reg },
        ])
      );
    }

    let collection = db.collection(USER_COLLECTION);
    if (clauses.length === 1) {
      collection = collection.where(clauses[0]);
    } else if (clauses.length > 1) {
      collection = collection.where(_.and(clauses));
    }

    const countRes = await collection.count();
    const total = countRes.total || 0;

    let list = [];
    try {
      const result = await collection
        .orderBy("createTime", "desc")
        .skip(skip)
        .limit(safePageSize)
        .get();
      list = result.data || [];
    } catch (orderErr) {
      // 部分历史数据无 createTime 索引时降级为无排序拉取
      const result = await collection.skip(skip).limit(safePageSize).get();
      list = (result.data || []).sort((a, b) => {
        const ta = new Date(a.createTime || a.lastLoginTime || 0).getTime();
        const tb = new Date(b.createTime || b.lastLoginTime || 0).getTime();
        return tb - ta;
      });
    }

    const mapped = list.map((u) => ({
      _id: u._id,
      nickName: u.nickName || "",
      avatarUrl: u.avatarUrl || "",
      phone: u.phone || "",
      email: u.email || "",
      role: u.role === "admin" ? "admin" : "user",
      adminRole: u.role === "admin" ? u.adminRole || "owner" : "",
      openid: u.openid || u._openid || "",
      notifySubscribed: !!u.notifySubscribed,
      createTime: u.createTime || null,
      lastLoginTime: u.lastLoginTime || null,
      updateTime: u.updateTime || null,
    }));

    return {
      success: true,
      list: mapped,
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  } catch (e) {
    return { success: false, errMsg: formatCloudError(e) || "加载用户失败" };
  }
};

const parseHttpEvent = (raw) => {
  if (!raw || typeof raw !== "object") return { isHttp: false, event: raw || {} };
  if (raw.httpMethod === "OPTIONS") return { isHttp: true, isOptions: true, event: raw };
  const isHttp = !!(raw.httpMethod || (raw.headers && raw.body !== undefined));
  if (!isHttp) return { isHttp: false, event: raw };
  let event = raw;
  if (typeof raw.body === "string") {
    if (raw.body) {
      try {
        event = JSON.parse(raw.body);
      } catch (e) {
        event = { success: false, errMsg: "请求体 JSON 格式错误" };
      }
    } else {
      event = {};
    }
  } else if (raw.body && typeof raw.body === "object") {
    event = raw.body;
  }
  return { isHttp: true, event };
};

const corsHeaders = () => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
});

const httpOptionsResponse = () => ({
  mpserverlessComposedResponse: true,
  isBase64Encoded: false,
  statusCode: 204,
  headers: corsHeaders(),
  body: "",
});

const httpJsonResponse = (data, statusCode = 200) => ({
  mpserverlessComposedResponse: true,
  isBase64Encoded: false,
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(data),
});

const handleEvent = async (event, meta = {}) => {
  const webToken = (event.data && event.data._webToken) || event._webToken || "";
  return requestContext.run({ webToken, isHttp: !!meta.isHttp }, () => handleEventInner(event));
};

const cleanupExpiredEphemeralData = async () => {
  const _ = db.command;
  const now = new Date();
  const tasks = [
    (async () => {
      await ensureCollection(CAPTCHA_COLLECTION);
      return db.collection(CAPTCHA_COLLECTION).where({ expireAt: _.lt(Date.now()) }).remove();
    })(),
    (async () => {
      await ensureCollection(WEB_LOGIN_COLLECTION);
      return db.collection(WEB_LOGIN_COLLECTION).where({ status: "pending", expireAt: _.lt(now) }).remove();
    })(),
    (async () => {
      await ensureCollection(WEB_LOGIN_COLLECTION);
      return db.collection(WEB_LOGIN_COLLECTION).where({ status: "confirmed", tokenExpireAt: _.lt(now) }).remove();
    })(),
  ];
  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === "rejected") console.error("cleanupExpiredEphemeralData failed", formatCloudError(result.reason));
  });
};

const handleEventInner = async (event) => {
  if (event.Type === "Timer") {
    const requestMeta = requestContext.getStore() || {};
    if (requestMeta.isHttp || getWxOpenId()) {
      return { success: false, errMsg: "\u975e\u6cd5\u7684\u5b9a\u65f6\u4efb\u52a1\u8bf7\u6c42" };
    }
    await cleanupExpiredEphemeralData();
    const triggerName = event.TriggerName || event.triggerName || "";
    if (triggerName === "dailyDigest") return await runScheduledDailyDigest();
    if (triggerName === "autoBackup") return await runScheduledBackup();
    return { success: true, skipped: true, reason: "\u672a\u77e5\u5b9a\u65f6\u4efb\u52a1" };
  }

  if (event.returnCode !== undefined || event.resultCode !== undefined) {
    const requestMeta = requestContext.getStore() || {};
    if (requestMeta.isHttp || getWxOpenId()) {
      return { success: false, errMsg: "\u975e\u6cd5\u7684\u652f\u4ed8\u56de\u8c03\u8bf7\u6c42" };
    }
    return await handlePayCallback(event);
  }

  switch (event.type) {
    case "getOpenId":
    case "getMiniProgramCode":
    case "createCollection":
    case "selectRecord":
    case "updateRecord":
    case "insertRecord":
    case "deleteRecord":
      return { success: false, errMsg: "该接口已停用" };
    case "submitForm":
      return await submitForm(event);
    case "getFormTemplate":
      return await getFormTemplate(event);
    case "verifyFormPassword":
      return await verifyFormPasswordApi(event);
    case "updateFormTemplate":
      return await updateFormTemplate(event);
    case "getMyForms":
      return await getMyForms(event);
    case "getMySubmissionForEdit":
      return await getMySubmissionForEdit(event);
    case "updateMySubmission":
      return await updateMySubmission(event);
    case "deleteMySubmission":
      return await deleteMySubmission(event);
    case "batchDeleteMySubmissions":
      return await batchDeleteMySubmissions(event);
    case "checkUser":
      return await checkUser();
    case "loginUser":
      return await loginUser();
    case "phoneLogin":
      return await phoneLogin(event);
    case "registerUser":
      return await registerUser(event);
    case "getUserProfile":
      return await getUserProfile();
    case "updateUserProfile":
      return await updateUserProfile(event);
    case "checkAdmin":
      return await checkAdmin();
    case "webAdminLogin":
      return await webAdminLogin(event);
    case "createWebLoginSession":
      return await createWebLoginSession();
    case "pollWebLoginSession":
      return await pollWebLoginSession(event);
    case "confirmWebLoginSession":
      return await confirmWebLoginSession(event);
    case "listPendingWebLoginSessions":
      return await listPendingWebLoginSessions();
    case "getFormStats":
      return await getFormStats(event);
    case "getFormAnalytics":
      return await getFormAnalytics();
    case "getAllForms":
      return await getAllForms(event);
    case "getFormDetail":
      return await getFormDetail(event);
    case "updateFormStatus":
      return await updateFormStatus(event);
    case "updateFormSubmission":
      return await updateFormSubmission(event);
    case "batchUpdateFormStatus":
      return await batchUpdateFormStatus(event);
    case "batchDeleteFormSubmissions":
      return await batchDeleteFormSubmissions(event);
    case "deleteFormSubmission":
      return await deleteFormSubmission(event);
    case "exportForms":
      return await exportForms(event);
    case "getFormQrCode":
      return await getFormQrCode(event);
    case "saveNotifySubscription":
      return await saveNotifySubscription(event);
    case "listNotifyTemplates":
      return await listNotifyTemplates();
    case "saveNotifyTemplate":
      return await saveNotifyTemplate(event);
    case "deleteNotifyTemplate":
      return await deleteNotifyTemplate(event);
    case "getAdminNotifyStatus":
      return await getAdminNotifyStatus(event);
    case "sendTestAdminNotify":
      return await sendTestAdminNotify(event);
    case "getAdminEmailConfig":
      return await getAdminEmailConfig(event);
    case "saveAdminEmailConfig":
      return await saveAdminEmailConfig(event);
    case "sendTestAdminEmail":
      return await sendTestAdminEmail(event);
    case "createPaymentOrder":
      return await createPaymentOrder(event);
    case "getAuditLogs":
      return await getAuditLogs(event);
    case "listUsers":
      return await listUsers(event);
    case "verifyCheckin":
      return await verifyCheckin(event);
    case "getAdminTeam":
      return await getAdminTeam();
    case "updateAdminRole":
      return await updateAdminRole(event);
    case "getCaptcha":
      return await getCaptcha();
    case "requestRefund":
      return await requestRefund(event);
    case "processRefund":
      return await processRefund(event);
    case "exportAttachments":
      return await exportAttachments(event);
    case "getMyVoucher":
      return await getMyVoucher(event);
    case "listFormTemplates":
      return await listFormTemplates();
    case "createFormTemplate":
      return await createFormTemplate(event);
    case "setDefaultFormTemplate":
      return await setDefaultFormTemplate(event);
    case "deleteFormTemplate":
      return await deleteFormTemplate(event);
    case "sendDailyDigest":
      return await sendDailyDigest();
    case "backupFormData":
      return await backupFormData(event);
    case "listBackups":
      return await listBackups();
    case "getFileTempUrl":
      return await getFileTempUrl(event);
    case "listPublicForms":
      return await listPublicForms();
    case "listBiaoxun":
      return await listBiaoxun(event);
    case "countBiaoxun":
      return await countBiaoxun(event);
    case "getBiaoxunDetail":
      return await getBiaoxunDetail(event);
    case "fetchBiaoxunAttachment":
      return await fetchBiaoxunAttachment(event);
    case "resolveBiaoxunHallImages":
      return await resolveBiaoxunHallImages(event);
    case "cleanupBiaoxunAttachment":
      return await cleanupBiaoxunAttachment(event);
    default:
      return { success: false, errMsg: `未支持的云函数类型: ${event.type}` };
  }
};

exports.main = async (event, context) => {
  const httpCtx = parseHttpEvent(event);
  if (httpCtx.isOptions) return httpOptionsResponse();
  const result = await handleEvent(httpCtx.event, { isHttp: httpCtx.isHttp });
  if (httpCtx.isHttp) return httpJsonResponse(result);
  return result;
};


