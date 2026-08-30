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

// 1. الاتصال بقاعدة بيانات MongoDB
const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error('⚠️ تحذير: لم يتم العثور على MONGO_URI في متغيرات البيئة!');
}

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح على Railway'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات MongoDB:', err));


// ==================== 2. نماذج قاعدة البيانات (Models) ====================

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  tierCode: { type: String, default: 'A1' },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  walletAddress: { type: String, default: '' },
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


// ==================== 3. موسط الحماية (Middleware) ====================

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ error: 'مطلوب توكن المصادقة' });
  
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(403).json({ error: 'صيغة التوكن غير صحيحة' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'التوكن غير صالح أو انتهت صلاحيته' });
  }
};


// ==================== 4. المسارات (API Routes) ====================

// 🤖 مسار المستشار الذكي المربوط بـ Groq SDK الرسمية (إرجاع JSON مباشر ليتوافق مع الواجهة الأمامية)
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

    // 🛡️ فلتر الكلمات الحساسة
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

    // إنشاء عميل Groq SDK
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

    // طلب الاستجابة مباشرة بنمط JSON عبر Groq SDK
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

    user.tierCode = tiers[currentIndex + 1];
    await user.save();

    res.status(200).json({ success: true, message: 'تمت الترقية بنجاح', tierCode: user.tierCode });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// تسجيل مستخدم جديد مع تفادي تكرار referralCode
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = 'BOOST' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90);

    const newUser = new User({ 
      email, 
      password: hashedPassword, 
      referralCode,
      wallet: { balance: 0, totalDeposits: 0, totalWithdrawn: 0 }
    });
    await newUser.save();
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
  } catch (err) {
    res.status(400).json({ error: 'خطأ التسجيل: ' + err.message });
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير مسجل' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
    }
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// طلب رمز استعادة كلمة المرور
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

// التحقق من صحة الرمز
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

// إعادة تعيين كلمة المرور
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

// البروفايل
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// إكمال المهام وتحديث الأرباح
app.post('/api/tasks/complete', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const tierLimits = { 'A1': 33, 'A2': 35, 'A3': 40, 'A4': 45, 'A5': 50 };
    const tierCommissions = { 'A1': 0.0346, 'A2': 0.0755, 'A3': 0.1518, 'A4': 0.3333, 'A5': 0.7571 };
    
    const maxTasks = tierLimits[user.tierCode] || 33;
    const commission = tierCommissions[user.tierCode] || 0.0346;

    if (user.todayCompletedTasks >= maxTasks) {
      return res.status(400).json({ error: 'لقد أتممت جميع مهام اليوم' });
    }

    if (!user.wallet) user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };

    user.assetWallet += commission;
    user.wallet.balance += commission;
    user.todayCompletedTasks += 1;
    await user.save();

    res.status(200).json({ success: true, assetWallet: user.assetWallet, wallet: user.wallet, completed: user.todayCompletedTasks });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// الإيداع
app.post('/api/wallet/deposit', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'مبلغ الإيداع غير صالح' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (!user.wallet) {
      user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };
    }

    user.wallet.balance += Number(amount);
    user.wallet.totalDeposits += Number(amount);
    await user.save();

    const depositTransaction = new Transaction({
      userId: user._id,
      type: 'deposit',
      amount: Number(amount),
      walletAddress: 'System Deposit',
      status: 'approved'
    });
    await depositTransaction.save();

    res.status(200).json({ success: true, message: 'تم إيداع الرصيد بنجاح', wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// عجلة الحظ
app.post('/api/spin/wheel', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardAmount = 5.00;
    if (!user.wallet) user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };

    user.wallet.balance += rewardAmount;
    await user.save();

    const rewardTransaction = new Transaction({
      userId: user._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Lucky Spin Wheel',
      status: 'approved'
    });
    await rewardTransaction.save();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// الصندوق الغامض
app.post('/api/spin/mystery-box', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardAmount = 10.00;
    if (!user.wallet) user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };

    user.wallet.balance += rewardAmount;
    await user.save();

    const rewardTransaction = new Transaction({
      userId: user._id,
      type: 'reward',
      amount: rewardAmount,
      walletAddress: 'Mystery Box',
      status: 'approved'
    });
    await rewardTransaction.save();

    res.status(200).json({ success: true, reward: rewardAmount, wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// السحب
const maxWithdrawLimits = { 'A1': 15, 'A2': 35, 'A3': 80, 'A4': 200, 'A5': 500 };

app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount, walletAddress } = req.body;
    if (!amount || amount < 20) return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });

    const user = await User.findById(req.user.id);
    const maxLimit = maxWithdrawLimits[user.tierCode] || 15;

    if (amount > maxLimit) {
      return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${maxLimit}$` });
    }
    
    if (!user.wallet) user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };

    if (user.wallet.balance < amount) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ' });
    }

    user.wallet.balance -= Number(amount);
    user.wallet.totalWithdrawn += Number(amount);
    await user.save();

    const withdrawal = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount: Number(amount),
      walletAddress,
      status: 'pending'
    });
    await withdrawal.save();

    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🚀 تشغيل الخادم
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
});
