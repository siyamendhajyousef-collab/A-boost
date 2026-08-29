const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// تفعيل الواجهة الأماميةت
app.use(express.static(path.join(__dirname)));

const JWT_SECRET = 'boost_secret_key_2026';

// 1. اتصال قاعدة البيانات (MongoDB Atlas)
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://your_username:your_password@cluster0.xxxxx.mongodb.net/boostDB?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
  .catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));


// ==================== 2. نماذج قاعدة البيانات (Models) ====================

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  tierCode: { type: String, default: 'A1' },
  assetWallet: { type: Number, default: 0 },
  todayCompletedTasks: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  walletAddress: { type: String, default: '' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdraw'], required: true },
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

    const newUser = new User({ email, password: hashedPassword, referralCode });
    await newUser.save();
    res.status(201).json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
  } catch (err) {
    res.status(400).json({ error: 'خطأ التسجيل: ' + err.message });
  }
});

// تسجيل الدخول (مع إظهار رسالة الخطأ التقنية إن وجدت)
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

// طلب سحب أسبوعي
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
    if (user.assetWallet < amount) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ' });
    }

    user.assetWallet -= amount;
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


// تشغيل الخادم
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`الخادم يعمل بانتظام على المنفذ ${PORT}`);
});
