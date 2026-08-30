const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Resend } = require('resend');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname)));

// 🔐 إعدادات المفتاح السري ومتغيرات البيئة
const JWT_SECRET = process.env.JWT_SECRET || 'boost_secret_key_2026';

// 📧 إعداد عميل Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 🕹️ متغيرات إعدادات الألعاب (يمكن تعديلها حياً من الأدمن)
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

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  tierCode: { type: String, default: 'A1' },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  walletAddress: { type: String, default: '' },
  isBanned: { type: Boolean, default: false },
  wallet: {
    balance: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 }
  },
  resetOTP: { type: String, default: null },
  resetOTPExpire: { type: Date, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw', 'reward'], required: true },
  amount: { type: Number, required: true },
  walletAddress: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح على Railway');
    
    // 👑 تحويل حسابك الشخصي تلقائياً إلى الأدمن الرئيسي
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


// ==================== 4. المسارات (API Routes) ====================

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
      model: "openai/gpt-oss-120b",
      temperature: 1,
      max_completion_tokens: 2048,
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
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const tiers = ['A1', 'A2', 'A3', 'A4', 'A5'];
    const currentIndex = tiers.indexOf(user.tierCode);

    if (currentIndex === -1 || currentIndex === tiers.length - 1) {
      return res.status(400).json({ error: 'أنت في المستوى الأقصى بالفعل' });
    }

    const nextTier = tiers[currentIndex + 1];

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id, tierCode: user.tierCode },
      { $set: { tierCode: nextTier } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(400).json({ error: 'حدثت تغييرات في الجلسة، يرجى المحاولة مرة أخرى' });
    }

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

    // البحث بالاعتماد على referralCode الخاص بالمستخدم الحالي
    const referrals = await User.find({ referredBy: currentUser.referralCode })
      .select('email tierCode createdAt wallet.balance')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      referralCode: currentUser.referralCode,
      referredBy: currentUser.referredBy || null, // تم إضافة حقل من دعا المستخدم لتعزيز الشفافية
      totalReferrals: referrals.length,
      referrals
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 📝 تسجيل مستخدم جديد (مُعدل للتعامل مع كود الإحالة بشكل مرن وبحث دقيق)
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
      const cleanCode = referralCode.trim();
      // التحقق مما إذا كان كود الإحالة موجوداً لأي مستخدم مسبقاً في النظام
      const referrerUser = await User.findOne({ referralCode: cleanCode });
      if (referrerUser) {
        validReferralCode = referrerUser.referralCode;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = 'BOOST' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90);

    const newUser = new User({ 
      email, 
      password: hashedPassword, 
      referralCode: newReferralCode,
      referredBy: validReferralCode, // سيتم تخزين كود الإحالة الصحيح هنا أو null
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

// ✅ إكمال المهام وتحديث الأرباح
app.post('/api/tasks/complete', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const tierLimits = { 'A1': 33, 'A2': 35, 'A3': 40, 'A4': 45, 'A5': 50 };
    const tierCommissions = { 'A1': 0.0346, 'A2': 0.0755, 'A3': 0.1518, 'A4': 0.3333, 'A5': 0.7571 };
    
    const maxTasks = tierLimits[user.tierCode] || 33;
    const commission = tierCommissions[user.tierCode] || 0.0346;

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
    const { amount } = req.body;
    const depositNum = Number(amount);
    if (!depositNum || depositNum <= 0) {
      return res.status(400).json({ error: 'مبلغ الإيداع غير صالح' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        $inc: {
          'wallet.balance': depositNum,
          'wallet.totalDeposits': depositNum
        }
      },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const depositTransaction = new Transaction({
      userId: updatedUser._id,
      type: 'deposit',
      amount: depositNum,
      walletAddress: 'System Deposit',
      status: 'approved'
    });
    await depositTransaction.save();

    res.status(200).json({ success: true, message: 'تم إيداع الرصيد بنجاح', wallet: updatedUser.wallet });
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
const maxWithdrawLimits = { 'A1': 15, 'A2': 35, 'A3': 80, 'A4': 200, 'A5': 500 };

app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount, walletAddress } = req.body;
    const withdrawNum = Number(amount);

    if (!withdrawNum || withdrawNum < 20) {
      return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });
    }

    if (!walletAddress || walletAddress.trim() === '') {
      return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const maxLimit = maxWithdrawLimits[user.tierCode] || 15;

    if (withdrawNum > maxLimit) {
      return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${maxLimit}$` });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.id, 'wallet.balance': { $gte: withdrawNum } },
      {
        $inc: {
          'wallet.balance': -withdrawNum,
          'wallet.totalWithdrawn': withdrawNum
        }
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
      walletAddress,
      status: 'pending'
    });
    await withdrawal.save();

    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح', wallet: updatedUser.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});


// ==================== 5. مسارات الإدارة (Admin APIs) ====================

// 🔐 الرابط السري لفتح صفحة الأدمن
app.get('/my-secret-admin-panel-99', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
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

// ✏️ تعديل بيانات مستخدم (الرصيد، المستوى، أو عنوان المحفظة من الإدارة)
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

// 💸 جلب طلبات السحب
app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ type: 'withdraw' })
      .populate('userId', 'email tierCode')
      .sort({ createdAt: -1 });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// ⚙️ الموافقة أو رفض طلب سحب
app.post('/api/admin/withdrawals/action', verifyAdmin, async (req, res) => {
  try {
    const { transactionId, action } = req.body;
    const tx = await Transaction.findById(transactionId);
    if (!tx) return res.status(404).json({ error: 'المعاملة غير موجودة' });

    if (tx.status !== 'pending') {
      return res.status(400).json({ error: 'تمت معالجة هذه المعاملة سابقاً' });
    }

    if (action === 'approve') {
      tx.status = 'approved';
    } else if (action === 'reject') {
      tx.status, 'rejected';
      await User.findByIdAndUpdate(tx.userId, {
        $inc: { 'wallet.balance': tx.amount, 'wallet.totalWithdrawn': -tx.amount }
      });
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

// 📢 مسار البث والإشعارات
app.post('/api/admin/broadcast', verifyAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'يرجى إدخال العنوان والنص' });
    }
    
    res.json({ success: true, message: 'تم إرسال البث بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});


// ==================== 6. تشغيل الخادم ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
});
