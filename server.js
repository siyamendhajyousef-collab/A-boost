const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname)));

// 🔐 إعدادات المفتاح السري ومتغيرات البيئة على Railway
const JWT_SECRET = process.env.JWT_SECRET || 'boost_secret_key_2026';

// 📧 إعداد موصل البريد الإلكتروني (Resend SMTP Transporter)
const transporter = nodemailer.createTransport({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: {
    user: 'resend', // تترك الكلمة كما هي
    pass: process.env.RESEND_API_KEY // يتم قرائته من متغيرات البيئة في Railway
  }
});

// 1. الاتصال بقاعدة بيانات MongoDB (Railway Environment Variable)
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
  // 🔑 حقول استعادة كلمة المرور عبر الـ OTP
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
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'مطلوب توكن المصادقة' });
  try {
    const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'التوكن غير صالح' });
  }
};


// ==================== 4. المسارات (API Routes) ====================

// تسجيل مستخدم جديد
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = 'BOOST' + Math.floor(1000 + Math.random() * 9000);

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

// 🔑 1. طلب رمز استعادة كلمة المرور عبر Resend OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني' });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'البريد الإلكتروني غير مسجل لدينا' });
    }

    // توليد رمز OTP مكون من 6 أرقام
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // صلاحية الرمز 10 دقائق
    user.resetOTP = otp;
    user.resetOTPExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    const mailOptions = {
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
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' });

  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال البريد الإلكتروني: ' + err.message });
  }
});

// 🔑 2. التحقق من صحة الرمز (Verify OTP)
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

// 🔑 3. إعادة تعيين كلمة المرور الجديدة (Reset Password)
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

// جلب بيانات المستخدم الحالي
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// إنجاز مهمة يومية
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

    user.assetWallet += commission;
    user.todayCompletedTasks += 1;
    await user.save();

    res.status(200).json({ success: true, assetWallet: user.assetWallet, completed: user.todayCompletedTasks });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// شحن وإيداع رصيد المحفظة
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

// 🎡 مسار عجلة الحظ الكبرى
app.post('/api/spin/wheel', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardAmount = 5.00;

    if (!user.wallet) {
      user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };
    }

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

// 🎁 مسار الصندوق المفاجئ
app.post('/api/spin/mystery-box', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const rewardAmount = 10.00;

    if (!user.wallet) {
      user.wallet = { balance: 0, totalDeposits: 0, totalWithdrawn: 0 };
    }

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

// طلب سحب رصيد المحفظة
const maxWithdrawLimits = { 'A1': 15, 'A2': 35, 'A3': 80, 'A4': 200, 'A5': 500 };

app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount, walletAddress } = req.body;
    if (amount < 20) return res.status(400).json({ error: 'الحد الأدنى للسحب هو 20$ USDT' });

    const user = await User.findById(req.user.id);
    const maxLimit = maxWithdrawLimits[user.tierCode] || 15;

    if (amount > maxLimit) {
      return res.status(400).json({ error: `الحد الأقصى للسحب الأسبوعي لمستواك هو ${maxLimit}$` });
    }
    
    const currentBalance = (user.wallet && user.wallet.balance) ? user.wallet.balance : user.assetWallet;
    if (currentBalance < amount) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ' });
    }

    if (user.wallet && user.wallet.balance >= amount) {
      user.wallet.balance -= amount;
      user.wallet.totalWithdrawn += Number(amount);
    } else {
      user.assetWallet -= amount;
    }
    
    await user.save();

    const withdrawal = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount,
      walletAddress,
      status: 'pending'
    });
    await withdrawal.save();

    res.status(200).json({ success: true, message: 'تم تقديم طلب السحب بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ تقني: ' + err.message });
  }
});

// 🚀 تشغيل الخادم والربط الذاتي مع المنفذ المخصص من Railway
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
});
