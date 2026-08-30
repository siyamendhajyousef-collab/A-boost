const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Resend } = require('resend');
const Groq = require('groq-sdk');
const webpush = require('web-push');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(cors());

// 🛡️ تحديد معدل الطلبات لحماية السيرفر من هجمات DDoS واستهلاك الـ API
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 150, // حد أقصى 150 طلب لكل IP
  message: { error: 'تم تجاوز حد الطلبات المسموح به، يرجى المحاولة لاحقاً' }
});
app.use('/api/', limiter);

app.use(express.static(path.join(__dirname)));

// 🔐 إعدادات المفتاح السري ومتغيرات البيئة
const JWT_SECRET = process.env.JWT_SECRET || 'boost_secret_key_2026';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️ تحذير أمني: يرجى ضبط JWT_SECRET في متغيرات البيئة بدلاً من المفتاح الافتراضي!');
}

// 📧 إعداد عميل Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 🔔 إعداد مفاتيح Web Push (VAPID Keys)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'your_private_vapid_key_here';

try {
  webpush.setVapidDetails(
    'mailto:support@boost-platform.com',
    publicVapidKey,
    privateVapidKey
  );
} catch (e) {
  console.log('⚠️ ملاحظة حول إعدادات Web Push VAPID:', e.message);
}

// 🕹️ متغيرات إعدادات الألعاب
let gameSettings = {
  spinMin: 1,
  spinMax: 10,
  boxMin: 5,
  boxMax: 25
};

// ==================== 1. الاتصال بقاعدة البيانات ====================
const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error('⚠️ تحذير: لم يتم العثور على MONGO_URI في متغيرات البيئة!');
}

// ==================== 2. نماذج قاعدة البيانات (Models) ====================

const vipLevelSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  tasks: { type: Number, required: true },
  dailyProfit: { type: Number, required: true },
  monthlyProfit: { type: Number, required: true },
  yearlyProfit: { type: Number, required: true },
  badgeColor: { type: String, default: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' }
}, { timestamps: true });

const VipLevel = mongoose.model('VipLevel', vipLevelSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  tierCode: { type: String, default: 'A1' },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, uppercase: true, trim: true },
  referredBy: { type: String, default: null, uppercase: true, trim: true },
  walletAddress: { type: String, default: '' },
  isBanned: { type: Boolean, default: false },
  wallet: {
    balance: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 }
  },
  resetOTP: { type: String, default: null },
  resetOTPExpire: { type: Date, default: null },
  twoFactorCode: { type: String, default: null },
  twoFactorExpire: { type: Date, default: null },
  pushSubscription: { type: Object, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'reward', 'staking_reward'], required: true },
  amount: { type: Number, required: true },
  walletAddress: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

const stakingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  durationDays: { type: Number, enum: [7, 15, 30], required: true },
  profitRate: { type: Number, required: true },
  expectedProfit: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'completed', 'claimed'], default: 'active' }
}, { timestamps: true });

const Staking = mongoose.model('Staking', stakingSchema);

// دالة تهيئة مستويات VIP الافتراضية
async function seedVipLevels() {
  try {
    const count = await VipLevel.countDocuments();
    if (count === 0) {
      const defaultLevels = [
        { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
        { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400' },
        { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400' },
        { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400' },
        { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400' }
      ];
      await VipLevel.insertMany(defaultLevels);
      console.log('🌟 تم إنشاء مستويات VIP الافتراضية بنجاح في قاعدة البيانات');
    }
  } catch (err) {
    console.error('⚠️ خطأ أثناء تهيئة مستويات VIP:', err.message);
  }
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح على Railway');
    await seedVipLevels();
    try {
      const adminUser = await User.findOneAndUpdate(
        { email: 'asspetmax@gmail.com' },
        { role: 'admin' },
        { new: true }
      );
      if (adminUser) {
        console.log('👑 تم التأكد من صلاحيات الأدمن للحساب: asspetmax@gmail.com');
      }
    } catch (err) {
      console.error('⚠️ خطأ في تحديث صلاحية الأدمن:', err.message);
    }
  })
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات MongoDB:', err));


// ==================== 3. موسط الحماية (Middleware) ====================

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ error: 'مطلوب توكن المصادقة' });
  
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'صيغة التوكن غير صحيحة' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.isBanned) return res.status(403).json({ error: 'تم تعليق حسابك من قبل الإدارة. يرجى التواصل مع الدعم الفني.' });

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'التوكن غير صالح أو انتهت صلاحيته' });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'غير مصرح: لا يوجد توكن' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'صيغة التوكن غير صحيحة' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'وصول مرفوض: هذه المنطقة مخصصة للمدير فقط' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'جلسة غير صالحة أو انتهت الصلاحية' });
  }
};


// ==================== 4. المسارات العامة (Public & User APIs) ====================

// 💎 مسار جلب قائمة مستويات VIP للواجهة (عام)
app.get('/api/vip-levels', async (req, res) => {
  try {
    const levels = await VipLevel.find().sort({ price: 1 });
    res.status(200).json(levels);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب مستويات VIP: ' + err.message });
  }
});

// 🤖 مسار المستشار الذكي (Ag AI Advisor)
app.post('/api/ai/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ reply: 'يرجى كتابة سؤالك أولاً.' });
    }

    const user = await User.findById(req.user.id).select('-password');
    const userName = user ? user.email.split('@')[0] : 'المستخدم';
    const userBalance = user && user.wallet ? user.wallet.balance : 0;
    const userTier = user ? user.tierCode : 'A1';

    const cleanMessage = message.trim().toLowerCase();
    const flagKeywords = ['نصب', 'احتيال', 'سرقة', 'وهمي', 'فاشل', 'كذب', 'تزوير', 'حرام'];
    const isFlagged = flagKeywords.some(word => cleanMessage.includes(word));

    if (isFlagged) {
      return res.json({
        reply: `أهلاً بك يا ${userName}! جميع المعاملات في المنصة تشفر وتدار بتبعية عالية لضمان الأمان. نهدف دائماً لتوفير بيئة استثمارية آمنة ومربحة لجميع أعضائنا.`
      });
    }

    const apiKey = process.env.GROQ_API_KEY || process.env.Boostai;
    if (!apiKey) {
      console.error("⚠️ GROQ_API_KEY/Boostai is missing in environment variables!");
      return res.status(500).json({ reply: "المستشار الذكي غير متاح حالياً، يرجى إضافة مفتاح GROQ_API_KEY في متغيرات البيئة." });
    }

    const groq = new Groq({ apiKey: apiKey.trim() });

    const systemPrompt = `
أنت "Ag AI Advisor"، المستشار الذكي والداعم الرسمي لمنصة Ag Boost.
شخصيتك: احترافية، إيجابية جداً، مشجعة، وودودة.

معلومات العميل الحالي:
- الاسم: ${userName}
- الرصيد الحالي: ${userBalance}$
- المستوى الحالي: ${userTier}

قواعد الإجابة الصارمة:
1. أجب بشكل مباشر وديناميكي على سؤال المستخدم المحدد دون تكرار عبارات ترحيبية ثابتة.
2. اجعل الإجابة مختصرة ومفيدة (لا تتجاوز 2-3 جمل).
3. شجع المستخدم على إكمال المهام اليومية، الترقية للمستويات الأعلى، ودعوة الأصدقاء لزيادة أرباحه.
4. استخدم اللغة العربية الفصحى البسيطة.
`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      model: "openai/gpt-oss-120b", // 👈 تم التعديل إلى الموديل الشغال والموجود في سجلاتك بنجاح
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1
    });

    const replyText = completion.choices[0]?.message?.content;
    if (replyText) {
      return res.json({ reply: replyText.trim() });
    } else {
      return res.status(500).json({ reply: "عذراً، لم أتمكن من الحصول على رد حالياً." });
    }
  } catch (error) {
    console.error("❌ Groq SDK Error:", error);
    return res.status(500).json({ reply: "حدث خطأ أثناء الاتصال بالمستشار الذكي." });
  }
});

// 🚀 مسار ترقية المستوى (Upgrade Tier)
app.post('/api/user/upgrade', verifyToken, async (req, res) => {
  try {
    const { targetTier } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const levels = await VipLevel.find().sort({ price: 1 });
    const levelCodes = levels.map(l => l.code);

    let nextTier = targetTier;
    if (!nextTier) {
      const currentIndex = levelCodes.indexOf(user.tierCode);
      if (currentIndex === -1 || currentIndex === levelCodes.length - 1) {
        return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
      }
      nextTier = levelCodes[currentIndex + 1];
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id },
      { $set: { tierCode: nextTier } },
      { new: true }
    );

    res.status(200).json({ success: true, message: 'تمت الترقية بنجاح', tierCode: updatedUser.tierCode });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📌 مسار حفظ/تحديث عنوان محفظة السحب
app.post('/api/user/wallet-address', verifyToken, async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress || walletAddress.trim() === '') {
      return res.status(400).json({ error: 'يرجى إدخال عنوان محفظة صالح' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (user.walletAddress && user.walletAddress.trim() !== '') {
      return res.status(400).json({ 
        error: 'عنوان المحفظة مثبت سابقاً، لا يمكنك تعديله إلا عن طريق التواصل مع الأدمن.' 
      });
    }

    user.walletAddress = walletAddress.trim();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم حفظ وتثبيت عنوان المحفظة بنجاح',
      walletAddress: user.walletAddress
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🌳 مسار جلب شجرة الفريق (الإحالات)
app.get('/api/user/referrals', verifyToken, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const userCode = currentUser.referralCode ? currentUser.referralCode.trim().toUpperCase() : '';

    const referrals = await User.find({ 
      referredBy: { $regex: new RegExp(`^${userCode}$`, 'i') } 
    })
      .select('email tierCode createdAt wallet.balance')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      referralCode: currentUser.referralCode,
      referredBy: currentUser.referredBy || null,
      totalReferrals: referrals.length,
      referrals
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🔒 مسارات أمان التحقق الثنائي (2FA)
app.post('/api/user/2fa/send-code', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorCode = code;
    user.twoFactorExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    await resend.emails.send({
      from: 'BOOST Platform <onboarding@resend.dev>',
      to: user.email,
      subject: 'رمز التحقق الثنائي (2FA) - BOOST',
      html: `
        <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; text-align: center; background-color: #0f172a; color: #ffffff; border-radius: 10px;">
          <h2 style="color: #38bdf8; margin-bottom: 20px;">منصة BOOST - تأكيد العملية</h2>
          <p style="font-size: 16px;">رمز التحقق الخاص لتأكيد عملية السحب هو:</p>
          <div style="background-color: #1e293b; padding: 15px 25px; border-radius: 8px; display: inline-block; margin: 15px 0;">
            <h1 style="color: #fbbf24; font-size: 36px; letter-spacing: 6px; margin: 0;">${code}</h1>
          </div>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">هذا الرمز صالح لمدة 5 دقائق فقط.</p>
        </div>
      `
    });

    res.status(200).json({ success: true, message: 'تم إرسال رمز التحقق الثنائي إلى بريدك الإلكتروني' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إرسال الرمز: ' + err.message });
  }
});

// 🔔 مسار حفظ اشتراك الإشعارات الفورية
app.post('/api/push/subscribe', verifyToken, async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'بيانات الاشتراك غير صالحة' });
    }

    await User.findByIdAndUpdate(req.user.id, { pushSubscription: subscription });
    res.status(201).json({ success: true, message: 'تم حفظ اشتراك الإشعارات بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📈 مسارات نظام التخزين المؤقت (Staking Pool)
app.post('/api/staking/create', verifyToken, async (req, res) => {
  try {
    const { amount, durationDays } = req.body;
    const stakeAmount = Number(amount);
    const duration = Number(durationDays);

    if (!stakeAmount || stakeAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ التخزين غير صالح' });
    }

    if (![7, 15, 30].includes(duration)) {
      return res.status(400).json({ error: 'مدة التخزين المتاحة هي 7، 15، أو 30 يوماً فقط' });
    }

    let profitRate = 0.05;
    if (duration === 15) profitRate = 0.12;
    if (duration === 30) profitRate = 0.30;

    const expectedProfit = parseFloat((stakeAmount * profitRate).toFixed(2));

    const user = await User.findOneAndUpdate(
      { _id: req.user.id, 'wallet.balance': { $gte: stakeAmount } },
      { $inc: { 'wallet.balance': -stakeAmount } },
      { new: true }
    );

    if (!user) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ لإنشاء حزمة التخزين' });
    }

    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    const newStaking = new Staking({
      userId: user._id,
      amount: stakeAmount,
      durationDays: duration,
      profitRate,
      expectedProfit,
      endDate,
      status: 'active'
    });

    await newStaking.save();

    res.status(200).json({ success: true, message: 'تم تفعيل حزمة التخزين بنجاح', staking: newStaking });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

app.get('/api/staking/my', verifyToken, async (req, res) => {
  try {
    const stakings = await Staking.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, stakings });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

app.post('/api/staking/claim', verifyToken, async (req, res) => {
  try {
    const { stakingId } = req.body;
    const staking = await Staking.findOne({ _id: stakingId, userId: req.user.id });

    if (!staking) return res.status(404).json({ error: 'حزمة التخزين غير موجودة' });
    if (staking.status !== 'active') return res.status(400).json({ error: 'هذه الحزمة منتهية أو تم استلام أرباحها مسبقاً' });

    if (new Date() < new Date(staking.endDate)) {
      return res.status(400).json({ error: 'لم تنتهِ مدة التخزين المحددة بعد' });
    }

    staking.status = 'claimed';
    await staking.save();

    const totalReturn = staking.amount + staking.expectedProfit;

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { 'wallet.balance': totalReturn } },
      { new: true }
    );

    const tx = new Transaction({
      userId: req.user.id,
      type: 'staking_reward',
      amount: totalReturn,
      walletAddress: 'Staking Pool Reward',
      status: 'approved'
    });
    await tx.save();

    res.status(200).json({ success: true, message: 'تم استلام رأس المال والأرباح بنجاح', wallet: updatedUser.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🏆 لوحة المتصدرين الحية
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topUsers = await User.find({ isBanned: false })
      .sort({ 'wallet.balance': -1 })
      .limit(10)
      .select('email wallet.balance tierCode');

    const leaderboard = topUsers.map((u, index) => {
      const parts = u.email.split('@');
      const name = parts[0];
      const maskedEmail = name.length > 3 ? name.substring(0, 3) + '***@' + parts[1] : '***@' + parts[1];
      return {
        rank: index + 1,
        email: maskedEmail,
        balance: u.wallet ? u.wallet.balance : 0,
        tierCode: u.tierCode
      };
    });

    res.status(200).json({ success: true, leaderboard });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📝 تسجيل مستخدم جديد
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }

    let validReferralCode = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim() !== '') {
      const cleanCode = referralCode.trim().toUpperCase();
      const referrerUser = await User.findOne({ 
        referralCode: { $regex: new RegExp(`^${cleanCode}$`, 'i') } 
      });
      if (referrerUser) {
        validReferralCode = referrerUser.referralCode;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = ('BOOST' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90)).toUpperCase();

    const newUser = new User({ 
      email, 
      password: hashedPassword, 
      referralCode: newReferralCode,
      referredBy: validReferralCode, 
      wallet: { balance: 0, totalDeposits: 0, totalWithdrawn: 0 }
    });
    
    await newUser.save();
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
  } catch (err) {
    res.status(400).json({ error: 'خطأ التسجيل: ' + err.message });
  }
});

// 🔑 تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير مسجل' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'حسابك معطل حالياً من قبل الإدارة. يرجى التواصل مع الدعم.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
    }
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📩 طلب رمز استعادة كلمة المرور
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني' });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'البريد الإلكتروني غير مسجل لدينا' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.resetOTPExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    const { error } = await resend.emails.send({
      from: 'BOOST Platform <onboarding@resend.dev>',
      to: user.email,
      subject: 'رمز استعادة كلمة المرور - BOOST',
      html: `
        <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; text-align: center; background-color: #0f172a; color: #ffffff; border-radius: 10px;">
          <h2 style="color: #38bdf8; margin-bottom: 20px;">منصة BOOST</h2>
          <p style="font-size: 16px;">أهلاً بك، رمز التحقق الخاص بك لإعادة تعيين كلمة المرور هو:</p>
          <div style="background-color: #1e293b; padding: 15px 25px; border-radius: 8px; display: inline-block; margin: 15px 0;">
            <h1 style="color: #fbbf24; font-size: 36px; letter-spacing: 6px; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">هذا الرمز صالِح لمدة 10 دقائق فقط.</p>
        </div>
      `
    });

    if (error) {
      console.error('❌ Resend API Error:', error);
      return res.status(500).json({ error: 'فشل إرسال البريد: ' + error.message });
    }

    res.status(200).json({ success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' });

  } catch (err) {
    console.error('❌ Server Catch Error:', err);
    res.status(500).json({ error: 'فشل إرسال البريد الإلكتروني: ' + err.message });
  }
});

// 🔍 التحقق من صحة الرمز
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({
      email,
      resetOTP: otp,
      resetOTPExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته' });
    }

    res.status(200).json({ success: true, message: 'رمز التحقق صحيح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🔄 إعادة تعيين كلمة المرور
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({
      email,
      resetOTP: otp,
      resetOTPExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'جلسة التغيير غير صالحة أو انتهت الصلاحية' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOTP = null;
    user.resetOTPExpire = null;
    await user.save();

    res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 👤 البروفايل
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// ✅ إكمال المهام وتحديث الأرباح (ديناميكي وفق بيانات مستوى الـ VIP)
app.post('/api/tasks/complete', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // جلب بيانات المستوى الحالي من DB ديناميكيًا
    const vipLevel = await VipLevel.findOne({ code: user.tierCode });
    const maxTasks = vipLevel ? vipLevel.tasks : 33;
    const dailyProfit = vipLevel ? vipLevel.dailyProfit : 2.50;
    const commission = parseFloat((dailyProfit / maxTasks).toFixed(4));

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id, todayCompletedTasks: { $lt: maxTasks } },
      {
        $inc: {
          assetWallet: commission,
          'wallet.balance': commission,
          todayCompletedTasks: 1
        }
      },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(400).json({ error: 'لقد أتممت جميع مهام اليوم' });
    }

    res.status(200).json({ 
      success: true, 
      assetWallet: updatedUser.assetWallet, 
      wallet: updatedUser.wallet, 
      completed: updatedUser.todayCompletedTasks 
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 💳 الإيداع
app.post('/api/wallet/deposit', verifyToken, async (req, res) => {
  try {
    const { amount, txHash } = req.body;
    const depositNum = Number(amount);
    if (!depositNum || depositNum <= 0) {
      return res.status(400).json({ error: 'مبلغ الإيداع غير صالح' });
    }

    const depositTransaction = new Transaction({
      userId: req.user.id,
      type: 'deposit',
      amount: depositNum,
      walletAddress: txHash || 'Manual Deposit Request',
      status: 'pending'
    });
    await depositTransaction.save();

    res.status(200).json({ 
      success: true, 
      message: 'تم إرسال طلب الإيداع وهو قيد المراجعة والتأكيد', 
      transaction: depositTransaction 
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📜 جلب سجل المعاملات المالية للمستخدم الحالي
app.get('/api/transactions/my-history', verifyToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      transactions
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني في جلب السجل: ' + err.message });
  }
});

// 🎡 عجلة الحظ
app.post('/api/spin/wheel', verifyToken, async (req, res) => {
  try {
    const min = gameSettings.spinMin || 1;
    const max = gameSettings.spinMax || 10;
    const rewardAmount = parseFloat((Math.random() * (max - min) + min).toFixed(2));

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { 'wallet.balance': rewardAmount } },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardTransaction = new Transaction({
      userId: updatedUser._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Lucky Spin Wheel',
      status: 'approved'
    });
    await rewardTransaction.save();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🎁 الصندوق الغامض
app.post('/api/spin/mystery-box', verifyToken, async (req, res) => {
  try {
    const min = gameSettings.boxMin || 5;
    const max = gameSettings.boxMax || 25;
    const rewardAmount = parseFloat((Math.random() * (max - min) + min).toFixed(2));

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { 'wallet.balance': rewardAmount } },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardTransaction = new Transaction({
      userId: updatedUser._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Mystery Box',
      status: 'approved'
    });
    await rewardTransaction.save();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: updatedUser.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 💸 طلب السحب
app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount, walletAddress, twoFactorCode } = req.body;
    const withdrawNum = Number(amount);

    if (!withdrawNum || withdrawNum < 20) {
      return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });
    }

    if (!walletAddress || walletAddress.trim() === '') {
      return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (!twoFactorCode || user.twoFactorCode !== twoFactorCode || !user.twoFactorExpire || user.twoFactorExpire < Date.now()) {
      return res.status(400).json({ error: 'رمز التحقق الثنائي (2FA) غير صحيح أو انتهت صلاحيته' });
    }

    const vipLevel = await VipLevel.findOne({ code: user.tierCode });
    const maxLimit = vipLevel ? (vipLevel.price * 0.3) : 15;

    if (withdrawNum > maxLimit) {
      return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${maxLimit}$` });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id, 'wallet.balance': { $gte: withdrawNum } },
      {
        $inc: {
          'wallet.balance': -withdrawNum,
          'wallet.totalWithdrawn': withdrawNum
        },
        $set: { twoFactorCode: null, twoFactorExpire: null }
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ' });
    }

    const withdrawal = new Transaction({
      userId: updatedUser._id,
      type: 'withdraw',
      amount: withdrawNum,
      walletAddress: walletAddress.trim(),
      status: 'pending'
    });
    await withdrawal.save();

    // 📧 إرسال إشعار تقديم الطلب عبر البريد الإلكتروني
    try {
      const formattedDate = new Date().toLocaleString('ar-EG', { timeZone: 'UTC' });
      
      await resend.emails.send({
        from: 'BOOST Platform <onboarding@resend.dev>',
        to: user.email,
        subject: '⚠️ تم تقديم طلب سحب جديد - منصة BOOST',
        html: `
          <div style="direction: rtl; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 25px; background-color: #0b1329; color: #ffffff; border-radius: 12px; max-width: 600px; margin: auto; border: 1px solid #1e293b;">
            <div style="text-align: center; border-bottom: 2px solid #38bdf8; padding-bottom: 15px; margin-bottom: 20px;">
              <h1 style="color: #38bdf8; margin: 0; font-size: 24px;">منصة BOOST</h1>
              <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">إشعار استلام طلب السحب</p>
            </div>

            <p style="font-size: 16px; color: #e2e8f0;">مرحباً <strong>${user.email.split('@')[0]}</strong>،</p>
            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">تم استلام طلب السحب الخاص بك بنجاح، وهو حالياً قيد المراجعة والمعالجة من قبل الفريق المالي.</p>

            <div style="background-color: #1e293b; padding: 20px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #f59e0b;">
              <h3 style="color: #fbbf24; margin-top: 0; margin-bottom: 15px; font-size: 18px;">تفاصيل الطلب:</h3>
              
              <table style="width: 100%; border-collapse: collapse; text-align: right; color: #f8fafc; font-size: 14px;">
                <tr>
                  <td style="padding: 8px 0; color: #94a3b8;">المبلغ المطلوب:</td>
                  <td style="padding: 8px 0; font-weight: bold; color: #34d399; font-size: 16px;">$${withdrawNum} USDT</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #94a3b8;">معرف المعاملة (TxID):</td>
                  <td style="padding: 8px 0; font-family: monospace; color: #38bdf8;">#${withdrawal._id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #94a3b8;">عنوان المحفظة:</td>
                  <td style="padding: 8px 0; font-family: monospace; word-break: break-all; color: #f1f5f9;">${walletAddress.trim()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #94a3b8;">الحالة الحالية:</td>
                  <td style="padding: 8px 0;"><span style="background-color: #b45309; color: #fff; padding: 3px 8px; border-radius: 5px; font-size: 12px;">قيد المراجعة</span></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #94a3b8;">تاريخ الطلب:</td>
                  <td style="padding: 8px 0; color: #cbd5e1;">${formattedDate}</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
              * سيتم تحويل المبالغ وإرسال تأكيد فور الموافقة على العملية.
            </p>

            <div style="text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px solid #334155; font-size: 12px; color: #64748b;">
              جميع الحقوق محفوظة © منصة BOOST 2026
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('⚠️ فشل إرسال إشعار السحب عبر البريد:', emailErr.message);
    }

    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح وإرسال التفاصيل لبريدك الإلكتروني', wallet: updatedUser.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});


// ==================== 5. مسارات الإدارة (Admin APIs) ====================

// 🔐 الرابط السري لفتح صفحة الأدمن
app.get('/my-secret-admin-panel-99', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// 💎 إضافة أو تعديل مستوى VIP من الأدمن
app.post('/api/admin/vip-levels', verifyAdmin, async (req, res) => {
  try {
    const { code, name, price, tasks, dailyProfit, monthlyProfit, yearlyProfit, badgeColor } = req.body;

    if (!code || !name || price === undefined || !tasks || dailyProfit === undefined) {
      return res.status(400).json({ error: 'يرجى إدخال جميع البيانات الأساسية للمستوى' });
    }

    const levelData = {
      code: code.trim().toUpperCase(),
      name,
      price: Number(price),
      tasks: Number(tasks),
      dailyProfit: Number(dailyProfit),
      monthlyProfit: monthlyProfit ? Number(monthlyProfit) : (Number(dailyProfit) * 30),
      yearlyProfit: yearlyProfit ? Number(yearlyProfit) : (Number(dailyProfit) * 365),
      badgeColor: badgeColor || 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400'
    };

    const updatedLevel = await VipLevel.findOneAndUpdate(
      { code: levelData.code },
      levelData,
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'تم حفظ المستوى بنجاح', level: updatedLevel });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🗑️ حذف مستوى VIP من الأدمن
app.delete('/api/admin/vip-levels/:code', verifyAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const deleted = await VipLevel.findOneAndDelete({ code: code.toUpperCase() });
    if (!deleted) {
      return res.status(404).json({ error: 'المستوى غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف المستوى بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📊 الإحصائيات العامة
app.get('/api/admin/overview', verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
    
    const depositsResult = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const withdrawalsResult = await Transaction.aggregate([
      { $match: { type: 'withdraw', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalDeposits: depositsResult[0]?.total || 0,
        totalWithdrawals: withdrawalsResult[0]?.total || 0,
        pendingWithdrawals
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'خطأ تقني: ' + err.message });
  }
});

// 👥 قائمة المستخدمين
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🚫 حظر أو إلغاء حظر مستخدم
app.post('/api/admin/users/toggle-ban', verifyAdmin, async (req, res) => {
  try {
    const { userId, isBanned } = req.body;
    const user = await User.findByIdAndUpdate(userId, { isBanned }, { new: true });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    res.json({
      success: true,
      message: isBanned ? 'تم حظر المستخدم بنجاح' : 'تم إلغاء حظر المستخدم بنجاح',
      user
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// ✏️ تعديل بيانات مستخدم من الإدارة
app.post('/api/admin/users/update', verifyAdmin, async (req, res) => {
  try {
    const { userId, balance, tierCode, walletAddress } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (balance !== undefined) user.wallet.balance = Number(balance);
    if (tierCode) user.tierCode = tierCode;
    if (walletAddress !== undefined) user.walletAddress = walletAddress.trim();

    await user.save();
    res.json({ success: true, message: 'تم تعديل بيانات المستخدم بنجاح', user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 💸 جلب طلبات السحب والإيداع المعلقة للأدمن
app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: { $in: ['withdraw', 'deposit'] } })
      .populate('userId', 'email tierCode')
      .sort({ createdAt: -1 });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// ⚙️ الموافقة أو رفض طلب (سحب أو إيداع)
app.post('/api/admin/withdrawals/action', verifyAdmin, async (req, res) => {
  try {
    const { transactionId, action } = req.body;
    const tx = await Transaction.findById(transactionId).populate('userId');
    if (!tx) return res.status(404).json({ error: 'المعاملة غير موجودة' });

    if (tx.status !== 'pending') {
      return res.status(400).json({ error: 'تمت معالجة هذه المعاملة سابقاً' });
    }

    const user = tx.userId;

    if (action === 'approve') {
      tx.status = 'approved';
      if (tx.type === 'deposit') {
        await User.findByIdAndUpdate(user._id, {
          $inc: { 'wallet.balance': tx.amount, 'wallet.totalDeposits': tx.amount }
        });
      }

      if (tx.type === 'withdraw' && user && user.email) {
        try {
          const completedDate = new Date().toLocaleString('ar-EG', { timeZone: 'UTC' });
          await resend.emails.send({
            from: 'BOOST Platform <onboarding@resend.dev>',
            to: user.email,
            subject: '✅ تم إتمام عملية السحب بنجاح - منصة BOOST',
            html: `
              <div style="direction: rtl; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 25px; background-color: #0b1329; color: #ffffff; border-radius: 12px; max-width: 600px; margin: auto; border: 1px solid #10b981;">
                <div style="text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 15px; margin-bottom: 20px;">
                  <h1 style="color: #10b981; margin: 0; font-size: 24px;">منصة BOOST</h1>
                  <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">تأكيد تحويل واستلام الأرباح</p>
                </div>

                <p style="font-size: 16px; color: #e2e8f0;">مرحباً <strong>${user.email.split('@')[0]}</strong>،</p>
                <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">يسعدنا إبلاغك بأنه تم قبول طلب السحب الخاص بك وتحويل المبلغ بنجاح إلى محفظتك الإلكترونية!</p>

                <div style="background-color: #1e293b; padding: 20px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #10b981;">
                  <h3 style="color: #34d399; margin-top: 0; margin-bottom: 15px; font-size: 18px;">تفاصيل المعاملة المكتملة:</h3>
                  
                  <table style="width: 100%; border-collapse: collapse; text-align: right; color: #f8fafc; font-size: 14px;">
                    <tr>
                      <td style="padding: 8px 0; color: #94a3b8;">المبلغ المحول:</td>
                      <td style="padding: 8px 0; font-weight: bold; color: #10b981; font-size: 18px;">$${tx.amount} USDT</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #94a3b8;">معرف المعاملة (TxID):</td>
                      <td style="padding: 8px 0; font-family: monospace; color: #38bdf8;">#${tx._id}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #94a3b8;">إلى المحفظة:</td>
                      <td style="padding: 8px 0; font-family: monospace; word-break: break-all; color: #f1f5f9;">${tx.walletAddress}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #94a3b8;">حالة العملية:</td>
                      <td style="padding: 8px 0;"><span style="background-color: #065f46; color: #34d399; padding: 4px 10px; border-radius: 5px; font-size: 13px; font-weight: bold;">مكتملة بنجاح ✅</span></td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #94a3b8;">تاريخ التجهيز:</td>
                      <td style="padding: 8px 0; color: #cbd5e1;">${completedDate}</td>
                    </tr>
                  </table>
                </div>

                <p style="font-size: 14px; color: #cbd5e1; text-align: center; margin-top: 20px;">
                  شكراً لثقتك واستخدامك منصة <strong>BOOST</strong>. ونتمنى لك المزيد من الأرباح والنجاح!
                </p>

                <div style="text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px solid #334155; font-size: 12px; color: #64748b;">
                  جميع الحقوق محفوظة © منصة BOOST 2026
                </div>
              </div>
            `
          });
        } catch (emailErr) {
          console.error('⚠️ فشل إرسال بريد إتمام السحب:', emailErr.message);
        }
      }

    } else if (action === 'reject') {
      tx.status = 'rejected';
      if (tx.type === 'withdraw') {
        await User.findByIdAndUpdate(user._id, {
          $inc: { 'wallet.balance': tx.amount, 'wallet.totalWithdrawn': -tx.amount }
        });
      }
    } else {
      return res.status(400).json({ error: 'الإجراء المطلوب غير صالح' });
    }

    await tx.save();
    res.json({ success: true, message: `تمت عملية (${action === 'approve' ? 'الموافقة' : 'الرفض'}) بنجاح` });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🎮 جلب إعدادات الألعاب
app.get('/api/admin/settings/games', verifyAdmin, async (req, res) => {
  res.json({ success: true, settings: gameSettings });
});

// 🎮 حفظ إعدادات الألعاب والعجلة
app.post('/api/admin/settings/games', verifyAdmin, async (req, res) => {
  try {
    const { spinMin, spinMax, boxMin, boxMax } = req.body;
    if (spinMin !== undefined) gameSettings.spinMin = Number(spinMin);
    if (spinMax !== undefined) gameSettings.spinMax = Number(spinMax);
    if (boxMin !== undefined) gameSettings.boxMin = Number(boxMin);
    if (boxMax !== undefined) gameSettings.boxMax = Number(boxMax);

    res.json({ success: true, message: 'تم حفظ إعدادات الألعاب بنجاح', settings: gameSettings });
  } catch (err) {
    res.status(500).json({ success: false, error: 'خطأ تقني: ' + err.message });
  }
});

// 📢 مسار البث والإشعارات الفورية
app.post('/api/admin/broadcast', verifyAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'يرجى إدخال العنوان والنص' });
    }
    
    const usersWithPush = await User.find({ pushSubscription: { $ne: null } });
    const payload = JSON.stringify({ title, body });
    
    let sentCount = 0;
    for (const user of usersWithPush) {
      try {
        await webpush.sendNotification(user.pushSubscription, payload);
        sentCount++;
      } catch (pushErr) {
        console.error(`فشل إرسال إشعار للمستخدم ${user.email}:`, pushErr.message);
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          user.pushSubscription = null;
          await user.save();
        }
      }
    }

    res.json({ success: true, message: `تم إرسال البث والإشعارات الفورية بنجاح إلى (${sentCount}) مستخدماً` });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});


// ==================== 6. تشغيل الخادم ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
});
