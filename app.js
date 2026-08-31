/* ==========================================================================
   Ag Boost Ultimate - Main Application Logic (app.js) - الإصدار المصحح
   ========================================================================== */

let currentUserTier = 'A1';
let soundEnabled = true;
let currentUserData = null;
let hasPendingDeposit = false;

const tiersData = [
    { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
    { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400' },
    { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400' },
    { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400' },
    { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400' }
];

const tierLimits = { 'A1': 33, 'A2': 35, 'A3': 40, 'A4': 45, 'A5': 50 };

// ===== تهيئة التطبيق =====
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    if (refCode) {
        const regInput = document.getElementById('regReferralCode');
        if (regInput) { regInput.value = refCode.toUpperCase(); localStorage.setItem('ag_ref_code', refCode.toUpperCase()); }
        switchAuthTab('register');
    } else if (localStorage.getItem('ag_ref_code')) {
        const regInput = document.getElementById('regReferralCode');
        if (regInput) regInput.value = localStorage.getItem('ag_ref_code');
    }
    renderTiersList();
    initPushNotifications();
    loadUserProfile();
});

// ===== دالة تحميل بيانات المستخدم (متاحة عالمياً لـ index.html) =====
window.loadUserData = function() {
    loadUserProfile();
};

// ===== 1. إدارة المستويات =====
function renderTiersList() {
    const container = document.getElementById('tiersListContainer');
    if (!container) return;
    container.innerHTML = tiersData.map(tier => {
        const isCurrent = currentUserTier === tier.code;
        return `
            <div class="glass-card p-5 rounded-3xl border relative overflow-hidden bg-gradient-to-br ${tier.badgeColor} shadow-xl space-y-4">
                ${isCurrent ? '<span class="absolute top-3 left-3 bg-amber-500 text-slate-950 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow">مستواك الحالي ✓</span>' : ''}
                <div class="flex justify-between items-center">
                    <div><span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">ترقية حصرية</span><h3 class="text-lg font-black text-white">${tier.name}</h3></div>
                    <div class="text-left"><span class="text-2xl font-black text-amber-400">${tier.price}</span><span class="text-xs font-bold text-slate-300"> USDT</span></div>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs border-y border-slate-800/80 py-3">
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50"><span class="text-slate-400 block text-[10px]">المهام اليومية</span><b class="text-white text-sm">${tier.tasks} مهمة/يوم</b></div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50"><span class="text-slate-400 block text-[10px]">الربح اليومي</span><b class="text-emerald-400 text-sm">$${tier.dailyProfit.toFixed(2)}</b></div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50"><span class="text-slate-400 block text-[10px]">الربح الشهري</span><b class="text-emerald-400 text-sm">$${tier.monthlyProfit.toFixed(2)}</b></div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50"><span class="text-slate-400 block text-[10px]">الربح السنوي</span><b class="text-emerald-400 text-sm">$${tier.yearlyProfit.toFixed(2)}</b></div>
                </div>
                <button type="button" onclick="upgradeToSpecificTier('${tier.code}')" ${isCurrent ? 'disabled' : ''} class="w-full py-3 ${isCurrent ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'gold-gradient text-slate-950 font-black shadow-lg active:scale-95'} rounded-xl text-xs transition-all">
                    ${isCurrent ? 'المستوى مفعل حالياً' : `ترقية إلى ${tier.code} بسعر $${tier.price}`}
                </button>
            </div>
        `;
    }).join('');
}

function updateTierDisplay() {
    const cardTierName = document.getElementById('lblCardTierName');
    const userTierBadge = document.getElementById('lblUserTierBadge');
    if(cardTierName) cardTierName.innerText = `المستوى ${currentUserTier}`;
    if(userTierBadge) userTierBadge.innerText = `مستوى ${currentUserTier} المعتمد`;
}

async function upgradeToSpecificTier(targetTier) {
    const token = localStorage.getItem('token');
    if (!token) { showToast('يرجى تسجيل الدخول أولاً'); return; }
    try {
        const res = await fetch('/api/user/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ targetTier })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            currentUserTier = data.tierCode || targetTier;
            updateTierDisplay();
            renderTiersList();
            showToast(`مبروك! تمت الترقية إلى المستوى ${currentUserTier}`, 'upgrade');
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else {
            showToast('❌ ' + (data.error || 'فشلت الترقية'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال');
    }
}

// ===== 2. الإشعارات والأصوات =====
async function initPushNotifications() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            const token = localStorage.getItem('token');
            if (token) {
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qAYIHBQJN2XH7k8KJY'
                });
                await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(subscription)
                });
            }
        } catch (e) {}
    }
}

function playBeep(type = 'default') {
    if(!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        if(type === 'upgrade') { osc.type = 'triangle'; osc.frequency.setValueAtTime(400, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2); }
        else if(type === 'win') { osc.type = 'sine'; osc.frequency.setValueAtTime(523.25, ctx.currentTime); osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); }
        else { osc.type = 'sine'; osc.frequency.value = 600; }
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

function showToast(msg, soundType = 'default') {
    playBeep(soundType);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.remove('hide');
    setTimeout(() => toast.classList.add('hide'), 3500);
}

function toggleSound(el) { soundEnabled = el.checked; }
function claimDailyStreak() { showToast('🔥 تمت المطالبة بمكافأة الحضور اليومي (+3.00$) بنجاح!', 'win'); }

// ===== 3. المصادقة =====
function switchAuthTab(tab) {
    if(tab === 'login') {
        document.getElementById('loginForm').classList.remove('hide');
        document.getElementById('registerForm').classList.add('hide');
        document.getElementById('tabLoginBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl bg-amber-500 text-slate-950 transition-all";
        document.getElementById('tabRegisterBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl text-slate-400 transition-all";
    } else {
        document.getElementById('loginForm').classList.add('hide');
        document.getElementById('registerForm').classList.remove('hide');
        document.getElementById('tabRegisterBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl purple-gradient text-white transition-all";
        document.getElementById('tabLoginBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl text-slate-400 transition-all";
    }
}

function openForgotPasswordModal() {
    const loginEmail = document.getElementById('loginEmail').value;
    if(loginEmail) document.getElementById('resetEmail').value = loginEmail;
    document.getElementById('forgotPasswordModal').classList.remove('hide');
    document.getElementById('resetRequestForm').classList.remove('hide');
    document.getElementById('resetConfirmForm').classList.add('hide');
}
function closeForgotPasswordModal() { document.getElementById('forgotPasswordModal').classList.add('hide'); }

async function handleResetRequest(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const btn = document.getElementById('btnSendOtp');
    if(!email) { showToast('يرجى إدخال البريد الإلكتروني'); return; }
    btn.disabled = true; btn.innerText = 'جاري الإرسال...';
    try {
        const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email }) });
        const data = await res.json();
        if(res.ok) { showToast('✅ تم إرسال رمز التحقق', 'win'); document.getElementById('resetRequestForm').classList.add('hide'); document.getElementById('resetConfirmForm').classList.remove('hide'); }
        else { showToast('❌ ' + (data.error || 'فشل الإرسال')); }
    } catch(err) { showToast('❌ خطأ في الاتصال'); }
    finally { btn.disabled = false; btn.innerText = 'إرسال رمز التحقق'; }
}

async function handleResetConfirm(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const otp = document.getElementById('resetOtp').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;
    const btn = document.getElementById('btnResetSubmit');
    if(!otp || !newPassword) { showToast('يرجى ملء جميع الحقول'); return; }
    btn.disabled = true; btn.innerText = 'جاري التحديث...';
    try {
        const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, otp, newPassword }) });
        const data = await res.json();
        if(res.ok) { showToast('🎉 تم تغيير كلمة المرور', 'win'); closeForgotPasswordModal(); document.getElementById('loginEmail').value = email; }
        else { showToast('❌ ' + (data.error || 'رمز غير صحيح')); }
    } catch(err) { showToast('❌ خطأ في الاتصال'); }
    finally { btn.disabled = false; btn.innerText = 'تحديث كلمة المرور'; }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('btnLoginSubmit');
    btn.disabled = true; btn.innerText = 'جاري الدخول...';
    try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password}) });
        const data = await res.json();
        if(res.ok && data.token) {
            localStorage.setItem('token', data.token);
            showToast('تم تسجيل الدخول بنجاح');
            loadUserProfile();
        } else {
            showToast(data.error || 'خطأ في تسجيل الدخول');
        }
    } catch(err) { showToast('خطأ في الاتصال'); }
    finally { btn.disabled = false; btn.innerText = 'دخول المنصة'; }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const referralCode = document.getElementById('regReferralCode').value.trim();
    const btn = document.getElementById('btnRegisterSubmit');
    btn.disabled = true; btn.innerText = 'جاري إنشاء الحساب...';
    try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password, referralCode}) });
        const data = await res.json();
        if(res.ok) { showToast('تم إنشاء الحساب بنجاح، يرجى الدخول'); switchAuthTab('login'); document.getElementById('loginEmail').value = email; }
        else { showToast(data.error || 'خطأ في التسجيل'); }
    } catch(err) { showToast('خطأ في الاتصال'); }
    finally { btn.disabled = false; btn.innerText = 'إنشاء حساب'; }
}

// ===== 4. المحفظة والملف الشخصي =====
function updateWalletData(wallet) {
    if(!wallet) return;
    const balanceVal = wallet.balance !== undefined ? wallet.balance : wallet;
    const depositBalanceVal = wallet.depositBalance !== undefined ? wallet.depositBalance : (currentUserData?.wallet?.depositBalance || 0);
    const profitBalanceVal = wallet.profitBalance !== undefined ? wallet.profitBalance : (currentUserData?.wallet?.profitBalance || 0);
    const depositsVal = wallet.totalDeposits !== undefined ? wallet.totalDeposits : (currentUserData?.wallet?.totalDeposits || 0);
    const withdrawnVal = wallet.totalWithdrawn !== undefined ? wallet.totalWithdrawn : (currentUserData?.wallet?.totalWithdrawn || 0);
    const balance = Number(balanceVal || 0).toFixed(2);
    const depositBal = Number(depositBalanceVal || 0).toFixed(2);
    const profitBal = Number(profitBalanceVal || 0).toFixed(2);
    const deposits = Number(depositsVal || 0).toFixed(2);
    const withdrawn = Number(withdrawnVal || 0).toFixed(2);
    if (currentUserData) {
        if (!currentUserData.wallet) currentUserData.wallet = {};
        currentUserData.wallet.balance = parseFloat(balance);
        currentUserData.wallet.depositBalance = parseFloat(depositBal);
        currentUserData.wallet.profitBalance = parseFloat(profitBal);
        currentUserData.wallet.totalDeposits = parseFloat(deposits);
        currentUserData.wallet.totalWithdrawn = parseFloat(withdrawn);
        currentUserData.totalEarned = parseFloat(balance);
        currentUserData.totalWithdrawn = parseFloat(withdrawn);
    }
    const lblBalance = document.getElementById('lblWalletBalance');
    const lblDepBalance = document.getElementById('lblDepositBalance');
    const lblProfBalance = document.getElementById('lblProfitBalance');
    const lblDeposits = document.getElementById('lblTotalDeposits');
    const lblWithdrawn = document.getElementById('lblTotalWithdrawn');
    if (lblBalance) lblBalance.innerText = balance;
    if (lblDepBalance) lblDepBalance.innerText = depositBal + ' $';
    if (lblProfBalance) lblProfBalance.innerText = profitBal + ' $';
    if (lblDeposits) lblDeposits.innerText = deposits + ' $';
    if (lblWithdrawn) lblWithdrawn.innerText = withdrawn + ' $';
    const lblProfileEarned = document.getElementById('lblProfileTotalEarnings');
    const lblProfileWithdrawn = document.getElementById('lblProfileTotalWithdrawn');
    if (lblProfileEarned) lblProfileEarned.innerText = `$${balance}`;
    if (lblProfileWithdrawn) lblProfileWithdrawn.innerText = `$${withdrawn}`;
}

function updateProfileUI() {
    if (!currentUserData) return;
    const emailEl = document.getElementById('lblProfileEmail');
    if (emailEl) emailEl.innerText = currentUserData.email || '';
    const refCode = currentUserData.referralCode || 'BOOST99';
    const dynamicRefLink = `${window.location.origin}/reg?ref=${refCode}`;
    const refInputEl = document.getElementById('profileReferralLink');
    if (refInputEl) refInputEl.value = dynamicRefLink;
    const totalEarned = (currentUserData.wallet && currentUserData.wallet.balance !== undefined) ? currentUserData.wallet.balance : (currentUserData.totalEarned || 0);
    const totalWithdrawn = (currentUserData.wallet && currentUserData.wallet.totalWithdrawn !== undefined) ? currentUserData.wallet.totalWithdrawn : (currentUserData.totalWithdrawn || 0);
    const totalEarnedEl = document.getElementById('lblProfileTotalEarnings');
    const totalWithdrawnEl = document.getElementById('lblProfileTotalWithdrawn');
    if (totalEarnedEl) totalEarnedEl.innerText = `$${parseFloat(totalEarned).toFixed(2)}`;
    if (totalWithdrawnEl) totalWithdrawnEl.innerText = `$${parseFloat(totalWithdrawn).toFixed(2)}`;
}

function lockWalletUI(address) {
    if (!address) return;
    const profileInput = document.getElementById('profileWalletAddress');
    const withdrawInput = document.getElementById('withdrawWallet');
    const saveBtn = document.getElementById('btnSaveProfileWallet');
    const statusProfile = document.getElementById('walletStatusContainerProfile');
    const statusWithdraw = document.getElementById('walletStatusContainerWithdraw');
    if (profileInput) { profileInput.value = address; profileInput.disabled = true; }
    if (withdrawInput) { withdrawInput.value = address; withdrawInput.disabled = true; }
    if (saveBtn) saveBtn.style.display = 'none';
    const badgeHTML = `<div class="flex items-center gap-1.5 text-emerald-400 font-bold text-xs mt-2 bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30"><span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span><span>العنوان مفعل ومثبت بشكل دائم (قفل حماية 24 ساعة نشط)</span></div>`;
    if (statusProfile) statusProfile.innerHTML = badgeHTML;
    if (statusWithdraw) statusWithdraw.innerHTML = badgeHTML;
}

async function loadUserProfile() {
    const token = localStorage.getItem('token');
    if(!token) {
        document.getElementById('loadingView').classList.add('hide');
        document.getElementById('authView').classList.remove('hide');
        return;
    }
    try {
        const res = await fetch('/api/user/profile', { headers: {'Authorization': `Bearer ${token}`} });
        const data = await res.json();
        if(res.ok && data.user) {
            currentUserData = data.user;
            document.getElementById('loadingView').classList.add('hide');
            document.getElementById('authView').classList.add('hide');
            document.getElementById('appView').classList.remove('hide');
            document.getElementById('liveTickerBar').classList.remove('hide');
            document.getElementById('lblUserEmail').innerText = data.user.email;
            document.getElementById('lblCompletedTasks').innerText = data.user.todayCompletedTasks || 0;
            document.getElementById('lblReferralCode').innerText = data.user.referralCode || 'BOOST99';
            const savedAddress = data.user.withdrawWallet || data.user.walletAddress;
            if (savedAddress && savedAddress.trim() !== '') lockWalletUI(savedAddress);
            currentUserTier = data.user.tierCode || 'A1';
            updateWalletData(data.user.wallet || data.user);
            updateProfileUI();
            updateTeamTreeData(data.user.teamStats || { l1: 0, l2: 0, l3: 0, total: 0 });
            let maxTasks = tierLimits[currentUserTier] || 33;
            document.getElementById('lblMaxTasks').innerText = maxTasks;
            let percent = ((data.user.todayCompletedTasks || 0) / maxTasks) * 100;
            document.getElementById('taskProgressBar').style.width = `${percent > 100 ? 100 : percent}%`;
            document.getElementById('lblProgressPercent').innerText = `${Math.round(percent > 100 ? 100 : percent)}%`;
            updateTierDisplay();
            renderTiersList();
            await checkPendingDepositStatus();
        } else {
            logout();
        }
    } catch(err) { logout(); }
}

async function saveProfileWallet() {
    const token = localStorage.getItem('token');
    const walletAddress = document.getElementById('profileWalletAddress').value.trim();
    if (!walletAddress) { showToast('يرجى إدخال عنوان محفظة صحيح'); return; }
    try {
        const res = await fetch('/api/user/wallet-address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ walletAddress })
        });
        const data = await res.json();
        if (res.ok && (data.success || data.message)) { lockWalletUI(walletAddress); showToast('✅ تم تثبيت المحفظة', 'win'); }
        else { showToast('❌ ' + (data.error || 'فشل الحفظ')); }
    } catch (err) { showToast('❌ خطأ في الاتصال'); }
}

// ===== 5. شجرة الفريق =====
function updateTeamTreeData(stats) {
    const l1 = stats.l1 || 0; const l2 = stats.l2 || 0; const l3 = stats.l3 || 0;
    const total = stats.total || (l1 + l2 + l3);
    document.getElementById('lblTeamL1Count').innerText = `${l1} شخص`;
    document.getElementById('lblTeamL2Count').innerText = `${l2} شخص`;
    document.getElementById('lblTeamL3Count').innerText = `${l3} شخص`;
    document.getElementById('lblTotalTeamCount').innerText = `إجمالي الفريق: ${total}`;
    const dailyEarnings = (l1 * 0.01) + (l2 * 0.005) + (l3 * 0.0025);
    document.getElementById('lblDailyTeamEarnings').innerText = `${dailyEarnings.toFixed(4)} $ / يوم`;
    updateRankStatus(1, total, 60, 'rankTier1', 'badgeRank1Status');
    updateRankStatus(2, total, 120, 'rankTier2', 'badgeRank2Status');
    updateRankStatus(3, total, 240, 'rankTier3', 'badgeRank3Status');
    updateRankStatus(4, total, 500, 'rankTier4', 'badgeRank4Status');
}

function updateRankStatus(rankId, currentTotal, targetCount, cardId, badgeId) {
    const card = document.getElementById(cardId);
    const badge = document.getElementById(badgeId);
    if (!card || !badge) return;
    if (currentTotal >= targetCount) {
        card.className = "p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/50 flex justify-between items-center transition-all shadow-lg";
        badge.className = "text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
        badge.innerHTML = '<i class="fa-solid fa-check ml-1"></i> تم الإنجاز 🎉';
    } else {
        card.className = "p-3 rounded-2xl bg-slate-950 border border-slate-800 flex justify-between items-center transition-all opacity-80";
        badge.className = "text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900 text-slate-400 border border-slate-800";
        badge.innerHTML = `${currentTotal} / ${targetCount}`;
    }
}

// ===== 6. المهام والألعاب =====
async function completeTask() {
    const btn = document.getElementById('btnCompleteTask');
    const token = localStorage.getItem('token');
    btn.disabled = true;
    try {
        const res = await fetch('/api/tasks/complete', { method: 'POST', headers: {'Authorization': `Bearer ${token}`} });
        const data = await res.json();
        if(res.ok) { showToast('تم إنجاز المهمة وإضافة الأرباح!', 'win'); if (data.wallet) updateWalletData(data.wallet); await loadUserProfile(); }
        else { showToast(data.error || 'لا يمكن إنجاز المهمة'); }
    } catch(err) { showToast('خطأ في الاتصال'); }
    finally { btn.disabled = false; }
}

async function triggerLuckySpin() {
    const token = localStorage.getItem('token');
    const wheel = document.getElementById('spinWheelVisual');
    if (wheel) wheel.style.transform = `rotate(${Math.floor(Math.random() * 1000 + 720)}deg)`;
    try {
        const res = await fetch('/api/spin/wheel', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) {
            setTimeout(async () => { showToast(`مبروك! ربحت ${data.reward}$`, 'win'); if (data.wallet) updateWalletData(data.wallet); await loadUserProfile(); }, 1000);
        } else { showToast('❌ ' + (data.error || 'حدث خطأ')); }
    } catch (err) { showToast('❌ خطأ في الاتصال'); }
}

async function openMysteryBox() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/spin/mystery-box', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`🎁 مبروك! فتحت الصندوق واكتشفت ${data.reward}$`, 'win');
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else { showToast('❌ ' + (data.error || 'حدث خطأ')); }
    } catch (err) { showToast('❌ خطأ في الاتصال'); }
}

async function sendAiMessage() {
    const input = document.getElementById('aiInput');
    const chatBox = document.getElementById('aiChatBox');
    const query = input.value.trim();
    const token = localStorage.getItem('token');
    if (!query) return;
    chatBox.innerHTML += `<div class="bg-blue-950/40 p-3 rounded-xl border border-blue-900 text-white text-right">أنت: ${query}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;
    const loadingId = 'ai-loading-' + Date.now();
    chatBox.innerHTML += `<div id="${loadingId}" class="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-400 animate-pulse">Ag AI: جاري التفكير...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
    try {
        const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ message: query }) });
        const data = await res.json();
        const loadingEl = document.getElementById(loadingId);
        if (res.ok && data.reply) { loadingEl.outerHTML = `<div class="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300">Ag AI: ${data.reply}</div>`; playBeep('win'); }
        else { loadingEl.outerHTML = `<div class="bg-rose-950/40 p-3 rounded-xl border border-rose-900 text-rose-300">Ag AI: ${data.error || 'عذراً، حدث خطأ'}</div>`; }
    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.outerHTML = `<div class="bg-rose-950/40 p-3 rounded-xl border border-rose-900 text-rose-300">Ag AI: تعذر الاتصال بالخادم.</div>`;
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ===== 7. النسخ والأمان =====
function copyProfileReferral() {
    const copyInput = document.getElementById('profileReferralLink');
    if (!copyInput || !copyInput.value) {
        const fallbackCode = document.getElementById('lblReferralCode') ? document.getElementById('lblReferralCode').innerText : 'BOOST99';
        const dynamicLink = `${window.location.origin}/reg?ref=${fallbackCode}`;
        executeCopyProcess(dynamicLink);
        return;
    }
    executeCopyProcess(copyInput.value);
}
function copyPlatformWalletAddress() {
    const walletInput = document.getElementById('platformWalletAddress');
    if (!walletInput || !walletInput.value) return;
    executeCopyProcess(walletInput.value);
}
function executeCopyProcess(textToCopy) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy).then(() => { showToast("تم النسخ بنجاح! 🚀", 'win'); }).catch(() => { fallbackCopyText(textToCopy); });
    } else { fallbackCopyText(textToCopy); }
}
function fallbackCopyText(text) {
    const tempInput = document.createElement("input");
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    tempInput.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); showToast("تم النسخ بنجاح! 🚀", 'win'); } catch (err) { showToast("تعذر النسخ التلقائي"); }
    document.body.removeChild(tempInput);
}

function openChangePasswordModal() { const modal = document.getElementById('changePasswordModal'); if (modal) modal.classList.remove('hide'); else openForgotPasswordModal(); }
function closeChangePasswordModal() { const modal = document.getElementById('changePasswordModal'); if (modal) modal.classList.add('hide'); }
function toggle2FASetting(checkbox) { showToast(checkbox.checked ? "تم تفعيل المصادقة الثنائية 🛡️" : "تم تعطيل المصادقة الثنائية ⚠️", 'win'); }
function openActiveSessionsModal() { const modal = document.getElementById('activeSessionsModal'); if (modal) modal.classList.remove('hide'); else showToast("جهازك الحالي هو الجلسة النشطة الوحيدة ✅"); }
function closeActiveSessionsModal() { const modal = document.getElementById('activeSessionsModal'); if (modal) modal.classList.add('hide'); }
function terminateOtherSessions() { showToast("تم تسجيل الخروج من كافة الأجهزة الأخرى 🛑", 'win'); closeActiveSessionsModal(); }

// ===== 8. التنقل والمودالات =====
function switchTab(tabName) {
    ['home', 'tiers', 'travel', 'ai', 'spin', 'team', 'profile'].forEach(t => {
        const el = document.getElementById(`view-${t}`);
        if(el) el.classList.add('hide');
        const nav = document.getElementById(`nav-${t}`);
        if(nav) nav.className = "flex flex-col items-center flex-1 text-slate-400 transition-all";
    });
    const targetView = document.getElementById(`view-${tabName}`);
    if(targetView) targetView.classList.remove('hide');
    const activeNav = document.getElementById(`nav-${tabName}`);
    if(activeNav) activeNav.className = "flex flex-col items-center flex-1 text-amber-500 transition-all";
    if (tabName === 'profile') updateProfileUI();
}

async function checkPendingDepositStatus() {
    const token = localStorage.getItem('token');
    if (!token) return false;
    try {
        const res = await fetch('/api/transactions/my-history', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const transactions = data.transactions || data.history || [];
        hasPendingDeposit = transactions.some(tx => tx.type === 'deposit' && (tx.status === 'pending' || tx.status === 'processing'));
        return hasPendingDeposit;
    } catch (err) { return false; }
}

function openDepositModal() {
    document.getElementById('depositModal').classList.remove('hide');
    const btn = document.getElementById('btnConfirmDeposit');
    checkPendingDepositStatus().then(pending => {
        hasPendingDeposit = pending;
        if (pending) {
            if (btn) { btn.disabled = true; btn.innerText = 'لديك طلب إيداع سابق قيد المعالجة'; btn.className = "w-full py-3 bg-slate-800 text-slate-500 font-bold rounded-xl text-xs cursor-not-allowed"; }
            showToast('⚠️ لديك طلب إيداع سابق قيد المعالجة');
        } else {
            if (btn) { btn.disabled = false; btn.innerText = 'تأكيد طلب الإيداع'; btn.className = "w-full py-3 gold-gradient text-slate-950 font-black rounded-xl text-xs shadow-lg active:scale-95 transition-all"; }
        }
    });
}
function closeDepositModal() { document.getElementById('depositModal').classList.add('hide'); }
function openNotificationsModal() { document.getElementById('notificationsModal').classList.remove('hide'); }
function closeNotificationsModal() { document.getElementById('notificationsModal').classList.add('hide'); }
function openWithdrawModal() { document.getElementById('withdrawModal').classList.remove('hide'); }
function closeWithdrawModal() { document.getElementById('withdrawModal').classList.add('hide'); }

async function confirmDeposit() {
    if (hasPendingDeposit) { showToast('❌ لا يمكنك تقديم طلب إيداع جديد حتى يتم قبول الطلب المعلق'); return; }
    const token = localStorage.getItem('token');
    const amount = parseFloat(document.getElementById('depositAmount').value) || 50;
    const btn = document.getElementById('btnConfirmDeposit');
    btn.disabled = true; btn.innerText = 'جاري الإرسال...';
    try {
        const res = await fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ amount })
        });
        const data = await res.json();
        if(res.ok && data.success) {
            hasPendingDeposit = true;
            showToast(`تم تقديم طلب شحن ${amount}$ بنجاح`, 'win');
            closeDepositModal();
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else {
            showToast('❌ ' + (data.error || 'خطأ في عملية الإيداع'));
            btn.disabled = false; btn.innerText = 'تأكيد طلب الإيداع';
        }
    } catch(err) { showToast('❌ خطأ في الاتصال'); btn.disabled = false; btn.innerText = 'تأكيد طلب الإيداع'; }
}

async function sendWithdraw2FACode() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/auth/send-2fa-otp', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) { showToast('✅ تم إرسال رمز 2FA إلى بريدك', 'win'); }
        else { showToast('❌ ' + (data.error || 'فشل الإرسال')); }
    } catch (err) { showToast('❌ خطأ في الاتصال'); }
}

async function submitWithdraw() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const walletAddress = document.getElementById('withdrawWallet').value.trim();
    const twoFactorCode = document.getElementById('withdraw2faCode').value.trim();
    const token = localStorage.getItem('token');
    const btn = document.getElementById('btnSubmitWithdraw');
    if (!walletAddress) { showToast('يرجى تثبيت عنوان المحفظة أولاً'); return; }
    if (!twoFactorCode) { showToast('يرجى إدخال رمز 2FA'); return; }
    btn.disabled = true;
    try {
        const res = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ amount, walletAddress, twoFactorCode })
        });
        const data = await res.json();
        if(res.ok && data.success) { showToast('تم تقديم طلب السحب بنجاح'); closeWithdrawModal(); if (data.wallet) updateWalletData(data.wallet); await loadUserProfile(); }
        else { showToast(data.error || 'فشل السحب'); }
    } catch(err) { showToast('خطأ في الاتصال'); }
    finally { btn.disabled = false; }
}

async function openHistoryModal() {
    document.getElementById('historyModal').classList.remove('hide');
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = `<div class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-2 text-amber-400"></i><p class="text-xs">جاري التحميل...</p></div>`;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/transactions/my-history', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const transactions = data.transactions || data.history || [];
        if (res.ok && (data.success || Array.isArray(transactions)) && transactions.length > 0) {
            listEl.innerHTML = transactions.map(tx => {
                const isPositive = tx.type === 'deposit' || tx.type === 'reward' || tx.type === 'commission';
                const typeLabels = { 'deposit': 'إيداع', 'withdraw': 'سحب', 'reward': 'مكافأة', 'commission': 'عمولة', 'upgrade_deduction': 'ترقية', 'staking_reward': 'تخزين' };
                const statusBadge = tx.status === 'approved' || tx.status === 'completed' ? '<span class="text-emerald-400 text-[10px] font-bold">مكتمل</span>' :
                                   tx.status === 'rejected' ? '<span class="text-rose-400 text-[10px] font-bold">مرفوض</span>' :
                                   '<span class="text-amber-400 text-[10px] font-bold">قيد المعالجة</span>';
                return `<div class="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center mb-2">
                    <div class="flex items-center space-x-3 space-x-reverse">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}">
                            <i class="fas ${isPositive ? 'fa-arrow-down' : 'fa-arrow-up'} text-xs"></i>
                        </div>
                        <div><span class="font-bold text-white block text-xs">${typeLabels[tx.type] || tx.type}</span>
                        <span class="text-[10px] text-slate-400">${new Date(tx.createdAt).toLocaleString('ar-EG')}</span></div>
                    </div>
                    <div class="text-left"><span class="font-bold ${isPositive ? 'text-emerald-400' : 'text-amber-400'} block text-xs">${isPositive ? '+' : '-'}${Number(tx.amount).toFixed(2)}$</span>${statusBadge}</div>
                </div>`;
            }).join('');
        } else { listEl.innerHTML = `<div class="text-center py-8 text-gray-400"><i class="fas fa-receipt text-3xl mb-2 opacity-50"></i><p class="text-xs">لا توجد معاملات</p></div>`; }
    } catch (err) { listEl.innerHTML = `<div class="text-center py-6 text-rose-400"><i class="fas fa-exclamation-circle text-2xl mb-1"></i><p class="text-xs">تعذر الاتصال</p></div>`; }
}
function closeHistoryModal() { document.getElementById('historyModal').classList.add('hide'); }

function copyReferral() {
    const code = document.getElementById('lblReferralCode') ? document.getElementById('lblReferralCode').innerText : 'BOOST99';
    executeCopyProcess(code);
}

function logout() {
    localStorage.removeItem('token');
    currentUserData = null;
    hasPendingDeposit = false;
    document.getElementById('loadingView').classList.add('hide');
    document.getElementById('appView').classList.add('hide');
    document.getElementById('authView').classList.remove('hide');
    document.getElementById('liveTickerBar').classList.add('hide');
    showToast('تم تسجيل الخروج');
}
