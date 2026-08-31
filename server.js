// 🚀 BOOST Platform Backend Server - الإصدار المصحح والمكتمل

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const { Resend } = require('resend');
const Groq = require('groq-sdk');
const webpush = require('web-push');
const rateLimit = require('express-rate-limit');

const app = express();

// ===== الإعدادات الأساسية =====
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ===== CORS =====
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim().replace(/\/$/, ''))
  : [];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    const isAllowed = allowedOrigins.includes(origin.replace(/\/$/, '')) || origin.endsWith('.railway.app');
    if (isAllowed) callback(null, true);
    else callback(new Error('CORS Policy: Access denied'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ===== معدل الطلبات =====
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز حد الطلبات' } });
app.use('/api/', globalLimiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز محاولات الدخول' } });
app.use('/api/auth/', authLimiter);

app.use(express.static(path.join(__dirname)));

// ===== المتغيرات البيئية =====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ JWT_SECRET مفقود'); process.exit(1); }
const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL;
if (!MONGO_URI) { console.error('❌ MONGO_URI مفقود'); process.exit(1); }
const resendKey = process.env.RESEND_API_KEY;
const resend = resendKey ? new Resend(resendKey) : null;
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (publicVapidKey && privateVapidKey) {
  try { webpush.setVapidDetails('mailto:support@boost-platform.com', publicVapidKey, privateVapidKey); } catch (e) { console.warn('WebPush error:', e.message); }
}

// ===== إعدادات الألعاب =====
let gameSettings = { spinMin: 1, spinMax: 10, boxMin: 5, boxMax: 25 };

// ==================== نماذج قاعدة البيانات ====================

const vipLevelSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  tasks: { type: Number, required: true, min: 1 },
  dailyProfit: { type: Number, required: true, min: 0 },
  monthlyProfit: { type: Number, required: true, min: 0 },
  yearlyProfit: { type: Number, required: true, min: 0 },
  badgeColor: { type: String, default: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
  durationDays: { type: Number, default: 365, min: 1 },
  commissionRate: { type: Number, default: 0, min: 0, max: 100 }
}, { timestamps: true });
const VipLevel = mongoose.model('VipLevel', vipLevelSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  tierCode: { type: String, default: 'A1', uppercase: true, trim: true },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, uppercase: true, trim: true },
  referredBy: { type: String, default: null, uppercase: true, trim: true },
  walletAddress: { type: String, default: '', trim: true },
  isBanned: { type: Boolean, default: false },
  wallet: {
    balance: { type: Number, default: 0, min: 0 },
    depositBalance: { type: Number, default: 0, min: 0 },
    profitBalance: { type: Number, default: 0, min: 0 },
    totalDeposits: { type: Number, default: 0, min: 0 },
    totalWithdrawn: { type: Number, default: 0, min: 0 }
  },
  resetOTP: { type: String, default: null },
  resetOTPExpire: { type: Date, default: null },
  twoFactorCode: { type: String, default: null },
  twoFactorExpire: { type: Date, default: null },
  pushSubscription: { type: Object, default: null },
  teamStats: {
    l1: { type: Number, default: 0 },
    l2: { type: Number, default: 0 },
    l3: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'reward', 'staking_reward', 'referral_commission', 'upgrade_deduction'], required: true },
  amount: { type: Number, required: true },
  walletAddress: { type: String, required: true, trim: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  txHash: { type: String, default: '' }
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

const stakingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
  durationDays: { type: Number, enum: [7, 15, 30], required: true },
  profitRate: { type: Number, required: true },
  expectedProfit: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'completed', 'claimed'], default: 'active' }
}, { timestamps: true });
const Staking = mongoose.model('Staking', stakingSchema);

// ===== تهيئة المستويات الافتراضية =====
async function seedVipLevels() {
  try {
    const count = await VipLevel.countDocuments();
    if (count === 0) {
      await VipLevel.insertMany([
        { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400', durationDays: 365, commissionRate: 5 },
        { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400', durationDays: 365, commissionRate: 7 },
        { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400', durationDays: 365, commissionRate: 10 },
        { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400', durationDays: 365, commissionRate: 12 },
        { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400', durationDays: 365, commissionRate: 15 }
      ]);
      console.log('🌟 تم إنشاء مستويات VIP الافتراضية');
    }
  } catch (err) { console.error('⚠️ خطأ في تهيئة VIP:', err.message); }
}

// ===== موسطات المصادقة =====
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ error: 'مطلوب توكن' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'صيغة غير صحيحة' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password -resetOTP -twoFactorCode');
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (user.isBanned) return res.status(403).json({ error: 'تم تعليق الحساب' });
    req.user = decoded;
    next();
  } catch (err) { return res.status(401).json({ error: 'توكن غير صالح' }); }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'غير مصرح' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'صيغة غير صحيحة' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'admin' || user.isBanned) return res.status(403).json({ error: 'وصول مرفوض' });
    req.user = user;
    next();
  } catch (error) { return res.status(401).json({ error: 'جلسة غير صالحة' }); }
};

// ============================================================
// ===== 1. المسارات العامة والمستخدم =====
// ============================================================

// جلب مستويات VIP
app.get('/api/vip-levels', async (req, res) => {
  try { const levels = await VipLevel.find().sort({ price: 1 }); res.status(200).json(levels); } 
  catch (err) { res.status(500).json({ error: 'خطأ في المعالجة' }); }
});

// المستشار الذكي
app.post('/api/ai/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') return res.status(400).json({ reply: 'يرجى كتابة سؤالك.' });
    const user = await User.findById(req.user.id).select('-password');
    const userName = user ? user.email.split('@')[0] : 'المستخدم';
    const userBalance = user?.wallet?.balance || 0;
    const userTier = user?.tierCode || 'A1';
    const apiKey = process.env.GROQ_API_KEY || process.env.Boostai;
    if (!apiKey) return res.status(500).json({ reply: "المستشار غير متاح حالياً." });
    const groq = new Groq({ apiKey: apiKey.trim() });
    const systemPrompt = `أنت "Ag AI Advisor". معلومات العميل: الاسم: ${userName}, الرصيد: ${userBalance}$, المستوى: ${userTier}. أجب باختصار (2-3 جمل) وبشكل مباشر. شجع على إكمال المهام والترقية.`;
    const modelsToTry = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b'];
    let replyText = null;
    for (const model of modelsToTry) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
          model, temperature: 0.7, max_tokens: 512, top_p: 1
        });
        replyText = completion.choices[0]?.message?.content;
        if (replyText) break;
      } catch (e) { console.warn(`⚠️ فشل النموذج ${model}`); }
    }
    if (replyText) return res.json({ reply: replyText.trim() });
    return res.status(500).json({ reply: "عذراً، تعذر الحصول على رد." });
  } catch (error) { console.error('❌ AI Error:', error); return res.status(500).json({ reply: "حدث خطأ." }); }
});

// ترقية المستوى (المسار الرئيسي)
app.post('/api/user/upgrade', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { targetTier } = req.body;
    if (!targetTier) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'يرجى تحديد المستوى' }); }
    const user = await User.findById(req.user.id).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'مستخدم غير موجود' }); }
    const targetLevel = await VipLevel.findOne({ code: targetTier.toUpperCase() }).session(session);
    if (!targetLevel) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'المستوى غير موجود' }); }
    if (user.wallet.balance < targetLevel.price) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: `رصيد غير كافٍ. المطلوب: ${targetLevel.price}$، المتاح: ${user.wallet.balance}$` });
    }
    let remaining = targetLevel.price;
    if (user.wallet.depositBalance >= remaining) user.wallet.depositBalance -= remaining;
    else { remaining -= user.wallet.depositBalance; user.wallet.depositBalance = 0; user.wallet.profitBalance -= remaining; }
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    user.tierCode = targetLevel.code;
    await user.save({ session });
    const upgradeTx = new Transaction({ userId: user._id, type: 'upgrade_deduction', amount: targetLevel.price, walletAddress: `Upgrade to ${targetLevel.name}`, status: 'approved' });
    await upgradeTx.save({ session });
    if (user.referredBy) {
      const referrer = await User.findOne({ referralCode: user.referredBy }).session(session);
      if (referrer) {
        const commission = parseFloat((targetLevel.price * 0.10).toFixed(2));
        referrer.wallet.profitBalance += commission;
        referrer.wallet.balance = referrer.wallet.depositBalance + referrer.wallet.profitBalance;
        await referrer.save({ session });
        const commissionTx = new Transaction({ userId: referrer._id, type: 'referral_commission', amount: commission, walletAddress: `Commission from ${user.email}`, status: 'approved' });
        await commissionTx.save({ session });
      }
    }
    await session.commitTransaction(); session.endSession();
    res.status(200).json({ success: true, message: `تمت الترقية إلى ${targetLevel.name}`, tierCode: user.tierCode, wallet: user.wallet });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    console.error('Upgrade error:', err);
    res.status(500).json({ error: 'خطأ تقني' });
  }
});

// مسار التوافق مع /api/tiers/upgrade (لـ index.html)
app.post('/api/tiers/upgrade', verifyToken, (req, res) => {
  req.url = '/api/user/upgrade';
  app._router.handle(req, res);
});

// حفظ عنوان المحفظة
app.post('/api/user/wallet-address', verifyToken, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress || walletAddress.trim() === '') return res.status(400).json({ error: 'عنوان غير صالح' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (user.walletAddress && user.walletAddress.trim() !== '') return res.status(400).json({ error: 'مثبت سابقاً' });
    user.walletAddress = walletAddress.trim();
    await user.save();
    res.status(200).json({ success: true, message: 'تم التثبيت', walletAddress: user.walletAddress });
  } catch (err) { res.status(500).json({ error: 'خطأ في المعالجة' }); }
});

// شجرة الفريق
app.get('/api/user/referrals', verifyToken, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'مستخدم غير موجود' });
    const code = currentUser.referralCode?.trim().toUpperCase() || '';
    const l1 = await User.find({ referredBy: code }).select('email tierCode wallet.balance referralCode');
    const l1Codes = l1.map(u => u.referralCode).filter(c => c);
    const l2 = await User.find({ referredBy: { $in: l1Codes } }).select('email tierCode wallet.balance referralCode');
    const l2Codes = l2.map(u => u.referralCode).filter(c => c);
    const l3 = await User.find({ referredBy: { $in: l2Codes } }).select('email tierCode wallet.balance');
    const total = l1.length + l2.length + l3.length;
    await User.findByIdAndUpdate(req.user.id, { $set: { 'teamStats.l1': l1.length, 'teamStats.l2': l2.length, 'teamStats.l3': l3.length, 'teamStats.total': total } });
    res.status(200).json({ success: true, referralCode: currentUser.referralCode, totalReferrals: total, team: { level1: l1, level2: l2, level3: l3 } });
  } catch (err) { res.status(500).json({ error: 'خطأ في المعالجة' }); }
});

// إرسال 2FA
app.post('/api/user/2fa/send-code', verifyToken, async (req, res) => {
  try {
    if (!resend) return res.status(500).json({ error: 'البريد غير مهيأ' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorCode = code; user.twoFactorExpire = Date.now() + 5 * 60 * 1000;
    await user.save();
    await resend.emails.send({
      from: 'BOOST Platform <onboarding@resend.dev>',
      to: user.email,
      subject: 'رمز 2FA - BOOST',
      html: `<div style="direction:rtl;padding:20px;background:#0f172a;color:#fff;"><h2 style="color:#38bdf8;">رمز التحقق</h2><div style="background:#1e293b;padding:15px 25px;margin:15px 0;"><h1 style="color:#fbbf24;font-size:36px;">${code}</h1></div><p style="color:#94a3b8;">صالح لمدة 5 دقائق</p></div>`
    });
    res.status(200).json({ success: true, message: 'تم الإرسال' });
  } catch (err) { res.status(500).json({ error: 'خطأ في الإرسال' }); }
});

// مسار توافق 2FA للسحب
app.post('/api/auth/send-2fa-otp', verifyToken, (req, res) => {
  req.url = '/api/user/2fa/send-code';
  app._router.handle(req, res);
});

// اشتراك الإشعارات
app.post('/api/push/subscribe', verifyToken, async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'بيانات غير صالحة' });
    await User.findByIdAndUpdate(req.user.id, { pushSubscription: subscription });
    res.status(201).json({ success: true, message: 'تم الحفظ' });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// ===== نظام التخزين المؤقت =====
app.post('/api/staking/create', verifyToken, async (req, res) => {
  try {
    const { amount, durationDays } = req.body;
    const stakeAmount = Number(amount);
    const duration = Number(durationDays);
    if (!stakeAmount || stakeAmount <= 0) return res.status(400).json({ error: 'مبلغ غير صالح' });
    if (![7, 15, 30].includes(duration)) return res.status(400).json({ error: 'المدة غير صالحة' });
    const profitRate = duration === 7 ? 0.05 : duration === 15 ? 0.12 : 0.30;
    const expectedProfit = parseFloat((stakeAmount * profitRate).toFixed(2));
    const user = await User.findById(req.user.id);
    if (!user || user.wallet.balance < stakeAmount) return res.status(400).json({ error: 'رصيد غير كافٍ' });
    let remaining = stakeAmount;
    if (user.wallet.depositBalance >= remaining) user.wallet.depositBalance -= remaining;
    else { remaining -= user.wallet.depositBalance; user.wallet.depositBalance = 0; user.wallet.profitBalance -= remaining; }
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();
    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
    const staking = new Staking({ userId: user._id, amount: stakeAmount, durationDays: duration, profitRate, expectedProfit, endDate, status: 'active' });
    await staking.save();
    res.status(200).json({ success: true, message: 'تم التفعيل', staking });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/staking/my', verifyToken, async (req, res) => {
  try {
    const stakings = await Staking.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, stakings });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/staking/claim', verifyToken, async (req, res) => {
  try {
    const { stakingId } = req.body;
    const staking = await Staking.findOne({ _id: stakingId, userId: req.user.id });
    if (!staking) return res.status(404).json({ error: 'غير موجود' });
    if (staking.status !== 'active' || new Date() < new Date(staking.endDate)) return res.status(400).json({ error: 'غير مكتمل' });
    staking.status = 'claimed'; await staking.save();
    const user = await User.findById(req.user.id);
    user.wallet.depositBalance += staking.amount;
    user.wallet.profitBalance += staking.expectedProfit;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();
    await new Transaction({ userId: req.user.id, type: 'staking_reward', amount: staking.amount + staking.expectedProfit, walletAddress: 'Staking Reward', status: 'approved' }).save();
    res.status(200).json({ success: true, message: 'تم الاستلام', wallet: user.wallet });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// لوحة المتصدرين
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topUsers = await User.find({ isBanned: false }).sort({ 'wallet.balance': -1 }).limit(10).select('email wallet.balance tierCode');
    const leaderboard = topUsers.map((u, i) => {
      const parts = u.email.split('@');
      const name = parts[0];
      const masked = name.length > 3 ? name.substring(0, 3) + '***@' + parts[1] : '***@' + parts[1];
      return { rank: i + 1, email: masked, balance: u.wallet?.balance || 0, tierCode: u.tierCode };
    });
    res.status(200).json({ success: true, leaderboard });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// ============================================================
// ===== 2. مسارات المصادقة =====
// ============================================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });
    const cleanEmail = email.trim().toLowerCase();
    if (await User.findOne({ email: cleanEmail })) return res.status(400).json({ error: 'البريد مسجل' });
    let validRef = null;
    if (referralCode && referralCode.trim() !== '') {
      const referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (referrer) validRef = referrer.referralCode;
    }
    const hashed = await bcrypt.hash(password, 12);
    const newRefCode = ('BOOST' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90)).toUpperCase();
    const newUser = new User({ email: cleanEmail, password: hashed, referralCode: newRefCode, referredBy: validRef, wallet: { balance: 0, depositBalance: 0, profitBalance: 0, totalDeposits: 0, totalWithdrawn: 0 } });
    await newUser.save();
    if (validRef) {
      const referrer = await User.findOne({ referralCode: validRef });
      if (referrer) {
        const l1 = await User.countDocuments({ referredBy: validRef });
        const l1Codes = (await User.find({ referredBy: validRef }).select('referralCode')).map(u => u.referralCode).filter(c => c);
        const l2 = await User.countDocuments({ referredBy: { $in: l1Codes } });
        const l2Codes = (await User.find({ referredBy: { $in: l1Codes } }).select('referralCode')).map(u => u.referralCode).filter(c => c);
        const l3 = await User.countDocuments({ referredBy: { $in: l2Codes } });
        await User.findByIdAndUpdate(referrer._id, { $set: { 'teamStats.l1': l1, 'teamStats.l2': l2, 'teamStats.l3': l3, 'teamStats.total': l1 + l2 + l3 } });
      }
    }
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب' });
  } catch (err) { res.status(500).json({ error: 'فشل التسجيل' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'بيانات غير صحيحة' });
    if (user.isBanned) return res.status(403).json({ error: 'الحساب معطل' });
    if (user.wallet.depositBalance === undefined) user.wallet.depositBalance = 0;
    if (user.wallet.profitBalance === undefined) user.wallet.profitBalance = user.wallet.balance || 0;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    await user.save();
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const safeUser = { _id: user._id, email: user.email, role: user.role, tierCode: user.tierCode, assetWallet: user.assetWallet, todayCompletedTasks: user.todayCompletedTasks, referralCode: user.referralCode, referredBy: user.referredBy, walletAddress: user.walletAddress, isBanned: user.isBanned, wallet: user.wallet, teamStats: user.teamStats || { l1: 0, l2: 0, l3: 0, total: 0 } };
    res.status(200).json({ success: true, token, user: safeUser });
  } catch (err) { res.status(500).json({ error: 'خطأ في تسجيل الدخول' }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    if (!resend) return res.status(500).json({ error: 'البريد غير مهيأ' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'يرجى إدخال البريد' });
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(200).json({ success: true, message: 'إذا كان البريد مسجلاً ستصل الرسالة' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp; user.resetOTPExpire = Date.now() + 10 * 60 * 1000;
    await user.save();
    await resend.emails.send({
      from: 'BOOST Platform <onboarding@resend.dev>',
      to: user.email,
      subject: 'رمز استعادة كلمة المرور - BOOST',
      html: `<div style="direction:rtl;padding:20px;background:#0f172a;color:#fff;"><h2 style="color:#38bdf8;">رمز التحقق</h2><div style="background:#1e293b;padding:15px 25px;margin:15px 0;"><h1 style="color:#fbbf24;font-size:36px;">${otp}</h1></div><p style="color:#94a3b8;">صالح لمدة 10 دقائق</p></div>`
    });
    res.status(200).json({ success: true, message: 'تم الإرسال' });
  } catch (err) { res.status(500).json({ error: 'فشل الإرسال' }); }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'بيانات غير صالحة' });
    const user = await User.findOne({ email: email.trim().toLowerCase(), resetOTP: otp, resetOTPExpire: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ error: 'رمز غير صحيح أو منتهي' });
    res.status(200).json({ success: true, message: 'رمز صحيح' });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword || newPassword.length < 8) return res.status(400).json({ error: 'بيانات غير صالحة' });
    const user = await User.findOne({ email: email.trim().toLowerCase(), resetOTP: otp, resetOTPExpire: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ error: 'جلسة غير صالحة' });
    user.password = await bcrypt.hash(newPassword, 12);
    user.resetOTP = null; user.resetOTPExpire = null;
    await user.save();
    res.status(200).json({ success: true, message: 'تم التغيير' });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -resetOTP -twoFactorCode');
    res.status(200).json({ success: true, user });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// ===== إكمال المهام =====
app.post('/api/tasks/complete', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const user = await User.findById(req.user.id).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'مستخدم غير موجود' }); }
    const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
    const maxTasks = vipLevel ? vipLevel.tasks : 33;
    const dailyProfit = vipLevel ? vipLevel.dailyProfit : 2.50;
    const commission = parseFloat((dailyProfit / maxTasks).toFixed(4));
    const updated = await User.findOneAndUpdate(
      { _id: req.user.id, todayCompletedTasks: { $lt: maxTasks } },
      { $inc: { assetWallet: commission, 'wallet.profitBalance': commission, 'wallet.balance': commission, todayCompletedTasks: 1 } },
      { new: true, session }
    ).select('-password -resetOTP -twoFactorCode');
    if (!updated) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'أتممت جميع المهام' }); }
    await session.commitTransaction(); session.endSession();
    res.status(200).json({ success: true, assetWallet: updated.assetWallet, wallet: updated.wallet, completed: updated.todayCompletedTasks });
  } catch (err) { await session.abortTransaction(); session.endSession(); res.status(500).json({ error: 'خطأ' }); }
});

// ===== الإيداع =====
app.post('/api/wallet/deposit', verifyToken, async (req, res) => {
  try {
    const { amount, txHash, receipt } = req.body;
    const depositNum = Number(amount);
    if (!depositNum || depositNum <= 0) return res.status(400).json({ success: false, error: 'مبلغ غير صالح' });
    const pending = await Transaction.findOne({ userId: req.user.id, type: 'deposit', status: 'pending' });
    if (pending) return res.status(400).json({ success: false, error: 'لديك طلب قيد الانتظار' });
    const safeTx = receipt || (txHash && typeof txHash === 'string' ? txHash.trim() : 'Manual Deposit');
    const tx = new Transaction({ userId: req.user.id, type: 'deposit', amount: depositNum, walletAddress: safeTx, status: 'pending' });
    await tx.save();
    res.status(201).json({ success: true, message: 'تم تقديم الطلب', transaction: tx });
  } catch (err) { res.status(500).json({ success: false, error: 'خطأ في السيرفر' }); }
});

// ===== سجل المعاملات =====
app.get('/api/transactions/my-history', verifyToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, transactions });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// ===== عجلة الحظ =====
app.post('/api/spin/wheel', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const min = gameSettings.spinMin || 1, max = gameSettings.spinMax || 10;
    const reward = parseFloat((Math.random() * (max - min) + min).toFixed(2));
    const updated = await User.findByIdAndUpdate(req.user.id, { $inc: { 'wallet.profitBalance': reward, 'wallet.balance': reward } }, { new: true, session });
    if (!updated) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'مستخدم غير موجود' }); }
    await new Transaction({ userId: updated._id, type: 'reward', amount: reward, walletAddress: 'Lucky Spin', status: 'approved' }).save({ session });
    await session.commitTransaction(); session.endSession();
    res.status(200).json({ success: true, reward, wallet: updated.wallet });
  } catch (err) { await session.abortTransaction(); session.endSession(); res.status(500).json({ error: 'خطأ' }); }
});

// ===== الصندوق الغامض =====
app.post('/api/spin/mystery-box', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const min = gameSettings.boxMin || 5, max = gameSettings.boxMax || 25;
    const reward = parseFloat((Math.random() * (max - min) + min).toFixed(2));
    const updated = await User.findByIdAndUpdate(req.user.id, { $inc: { 'wallet.profitBalance': reward, 'wallet.balance': reward } }, { new: true, session });
    if (!updated) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'مستخدم غير موجود' }); }
    await new Transaction({ userId: updated._id, type: 'reward', amount: reward, walletAddress: 'Mystery Box', status: 'approved' }).save({ session });
    await session.commitTransaction(); session.endSession();
    res.status(200).json({ success: true, reward, wallet: updated.wallet });
  } catch (err) { await session.abortTransaction(); session.endSession(); res.status(500).json({ error: 'خطأ' }); }
});

// ===== السحب =====
app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { amount, walletAddress, twoFactorCode } = req.body;
    const withdrawNum = Number(amount);
    if (!withdrawNum || withdrawNum < 20) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'الحد الأدنى 20$' }); }
    if (!walletAddress || walletAddress.trim() === '') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'عنوان المحفظة مطلوب' }); }
    const user = await User.findById(req.user.id).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'مستخدم غير موجود' }); }
    if (!twoFactorCode || user.twoFactorCode !== twoFactorCode || !user.twoFactorExpire || user.twoFactorExpire < Date.now()) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: 'رمز 2FA غير صحيح أو منتهي' });
    }
    const vipLevel = await VipLevel.findOne({ code: user.tierCode }).session(session);
    const maxLimit = vipLevel ? (vipLevel.price * 0.3) : 15;
    if (withdrawNum > maxLimit) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: `الحد الأقصى ${maxLimit}$` }); }
    if (user.wallet.profitBalance < withdrawNum) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ error: `رصيد الأرباح غير كافٍ. المتاح: ${user.wallet.profitBalance}$` });
    }
    user.wallet.profitBalance -= withdrawNum;
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    user.wallet.totalWithdrawn += withdrawNum;
    user.twoFactorCode = null; user.twoFactorExpire = null;
    await user.save({ session });
    const withdrawal = new Transaction({ userId: user._id, type: 'withdraw', amount: withdrawNum, walletAddress: walletAddress.trim(), status: 'pending' });
    await withdrawal.save({ session });
    await session.commitTransaction(); session.endSession();
    if (resend) {
      try {
        await resend.emails.send({
          from: 'BOOST Platform <onboarding@resend.dev>',
          to: user.email,
          subject: '⚠️ طلب سحب جديد - BOOST',
          html: `<div style="direction:rtl;padding:20px;background:#0b1329;color:#fff;"><h2 style="color:#fbbf24;">تم استلام طلب السحب</h2><p>المبلغ: $${withdrawNum} USDT</p><p>العنوان: ${walletAddress.trim()}</p><p style="color:#94a3b8;">قيد المراجعة</p></div>`
        });
      } catch (e) { console.warn('فشل إرسال البريد:', e.message); }
    }
    res.status(200).json({ success: true, message: 'تم تقديم الطلب', wallet: user.wallet });
  } catch (err) { await session.abortTransaction(); session.endSession(); res.status(500).json({ error: 'خطأ' }); }
});

// ============================================================
// ===== 3. مسارات الإدارة (Admin APIs) =====
// ============================================================

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });

app.post('/api/admin/vip-levels', verifyAdmin, async (req, res) => {
  try {
    const { code, name, price, tasks, dailyProfit, monthlyProfit, yearlyProfit, badgeColor, durationDays, commissionRate } = req.body;
    if (!code || !name || price === undefined || !tasks || dailyProfit === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });
    const data = {
      code: code.trim().toUpperCase(), name, price: Number(price), tasks: Number(tasks),
      dailyProfit: Number(dailyProfit), monthlyProfit: monthlyProfit ? Number(monthlyProfit) : (Number(dailyProfit) * 30),
      yearlyProfit: yearlyProfit ? Number(yearlyProfit) : (Number(dailyProfit) * 365),
      badgeColor: badgeColor || 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400',
      durationDays: durationDays ? Number(durationDays) : 365,
      commissionRate: commissionRate !== undefined ? Number(commissionRate) : 0
    };
    const updated = await VipLevel.findOneAndUpdate({ code: data.code }, data, { upsert: true, new: true });
    res.json({ success: true, message: 'تم الحفظ', level: updated });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.delete('/api/admin/vip-levels/:code', verifyAdmin, async (req, res) => {
  try {
    const deleted = await VipLevel.findOneAndDelete({ code: req.params.code.toUpperCase() });
    if (!deleted) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true, message: 'تم الحذف' });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/admin/overview', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
    const depositsResult = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const withdrawalsResult = await Transaction.aggregate([{ $match: { type: 'withdraw', status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    res.json({ success: true, stats: { totalUsers, totalDeposits: depositsResult[0]?.total || 0, totalWithdrawals: withdrawalsResult[0]?.total || 0, pendingWithdrawals } });
  } catch (err) { res.status(500).json({ success: false, error: 'خطأ' }); }
});

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    let filter = {};
    if (search) filter.email = { $regex: search, $options: 'i' };
    const users = await User.find(filter).select('-password -resetOTP -twoFactorCode').sort({ createdAt: -1 }).skip(skip).limit(limit);
    const total = await User.countDocuments(filter);
    res.json({ users, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/admin/reset-daily-tasks', verifyAdmin, async (req, res) => {
  try { await User.updateMany({}, { $set: { todayCompletedTasks: 0 } }); res.json({ success: true, message: 'تم إعادة التعيين' }); } 
  catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/admin/users/toggle-ban', verifyAdmin, async (req, res) => {
  try {
    const { userId, isBanned } = req.body;
    const user = await User.findByIdAndUpdate(userId, { isBanned }, { new: true }).select('-password -resetOTP -twoFactorCode');
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    res.json({ success: true, message: isBanned ? 'تم الحظر' : 'تم إلغاء الحظر', user });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/admin/users/update', verifyAdmin, async (req, res) => {
  try {
    const { userId, depositBalance, profitBalance, tierCode, walletAddress, password } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (depositBalance !== undefined) user.wallet.depositBalance = Number(depositBalance);
    if (profitBalance !== undefined) user.wallet.profitBalance = Number(profitBalance);
    user.wallet.balance = user.wallet.depositBalance + user.wallet.profitBalance;
    if (tierCode) user.tierCode = tierCode;
    if (walletAddress !== undefined) user.walletAddress = String(walletAddress).trim();
    if (password && password.trim() !== '') user.password = await bcrypt.hash(password, 12);
    await user.save();
    const safe = user.toObject(); delete safe.password; delete safe.resetOTP; delete safe.twoFactorCode;
    res.json({ success: true, message: 'تم التحديث', user: safe });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status || 'all';
    const type = req.query.type || 'all';
    let filter = {};
    if (status !== 'all') filter.status = status;
    if (type !== 'all') filter.type = type;
    const transactions = await Transaction.find(filter).populate('userId', 'email tierCode').sort({ createdAt: -1 }).skip(skip).limit(limit);
    const total = await Transaction.countDocuments(filter);
    res.json({ success: true, withdrawals: transactions, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/admin/withdrawals/action', verifyAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { transactionId, action } = req.body;
    const tx = await Transaction.findById(transactionId).populate('userId').session(session);
    if (!tx) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ error: 'غير موجود' }); }
    if (tx.status !== 'pending') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'تمت معالجته سابقاً' }); }
    const user = tx.userId;
    if (action === 'approve') {
      tx.status = 'approved';
      if (tx.type === 'deposit') {
        await User.findByIdAndUpdate(user._id, { $inc: { 'wallet.depositBalance': tx.amount, 'wallet.balance': tx.amount, 'wallet.totalDeposits': tx.amount } }, { session });
      }
      if (tx.type === 'withdraw' && user?.email && resend) {
        try {
          await resend.emails.send({
            from: 'BOOST Platform <onboarding@resend.dev>',
            to: user.email,
            subject: '✅ تم إتمام السحب - BOOST',
            html: `<div style="direction:rtl;padding:20px;background:#0b1329;color:#fff;"><h2 style="color:#10b981;">تم إتمام السحب</h2><p>المبلغ: $${tx.amount} USDT</p><p>العنوان: ${tx.walletAddress}</p><p style="color:#94a3b8;">تم التحويل بنجاح</p></div>`
          });
        } catch (e) { console.warn('فشل البريد:', e.message); }
      }
    } else if (action === 'reject') {
      tx.status = 'rejected';
      if (tx.type === 'withdraw') {
        await User.findByIdAndUpdate(user._id, { $inc: { 'wallet.profitBalance': tx.amount, 'wallet.balance': tx.amount, 'wallet.totalWithdrawn': -tx.amount } }, { session });
      }
    } else { await session.abortTransaction(); session.endSession(); return res.status(400).json({ error: 'إجراء غير صالح' }); }
    await tx.save({ session });
    await session.commitTransaction(); session.endSession();
    res.json({ success: true, message: `تم ${action === 'approve' ? 'الموافقة' : 'الرفض'}` });
  } catch (err) { await session.abortTransaction(); session.endSession(); res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/admin/settings/games', verifyAdmin, (req, res) => { res.json({ success: true, settings: gameSettings }); });
app.post('/api/admin/settings/games', verifyAdmin, (req, res) => {
  try {
    const { spinMin, spinMax, boxMin, boxMax } = req.body;
    if (spinMin !== undefined) gameSettings.spinMin = Number(spinMin);
    if (spinMax !== undefined) gameSettings.spinMax = Number(spinMax);
    if (boxMin !== undefined) gameSettings.boxMin = Number(boxMin);
    if (boxMax !== undefined) gameSettings.boxMax = Number(boxMax);
    res.json({ success: true, message: 'تم الحفظ', settings: gameSettings });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/admin/broadcast', verifyAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
    const users = await User.find({ pushSubscription: { $ne: null } });
    const payload = JSON.stringify({ title, body });
    let sent = 0;
    for (const user of users) {
      try { await webpush.sendNotification(user.pushSubscription, payload); sent++; } 
      catch (e) { if (e.statusCode === 410 || e.statusCode === 404) { user.pushSubscription = null; await user.save(); } }
    }
    res.json({ success: true, message: `تم الإرسال إلى ${sent} مستخدم` });
  } catch (err) { res.status(500).json({ error: 'خطأ' }); }
});

// ============================================================
// ===== 4. تشغيل الخادم =====
// ============================================================

const PORT = process.env.PORT || 5000;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ تم الاتصال بقاعدة البيانات');
    await seedVipLevels();
    const server = app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`); });
  })
  .catch(err => { console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err); process.exit(1); });

process.on('unhandledRejection', (reason) => { console.error('⚠️ Unhandled Rejection:', reason); });
process.on('uncaughtException', (error) => { console.error('⚠️ Uncaught Exception:', error); });
