// 1. تنسيقات النافذة المنبثقة
const modalStyles = `
.deposit-modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.7); display: flex;
  justify-content: center; align-items: center; z-index: 9999;
}
.deposit-modal-card {
  background: #ffffff; padding: 25px; border-radius: 12px;
  width: 90%; max-width: 400px; direction: rtl; position: relative;
  font-family: system-ui, -apple-system, sans-serif;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2); color: #333;
}
.deposit-modal-close {
  position: absolute; top: 10px; left: 15px; font-size: 24px;
  cursor: pointer; color: #666; background: none; border: none;
}
.deposit-input-group { margin: 15px 0; }
.deposit-input-group label { display: block; margin-bottom: 5px; font-weight: bold; }
.deposit-input-group input {
  width: 100%; padding: 10px; border: 1px solid #ccc;
  border-radius: 6px; box-sizing: border-box; font-size: 16px;
}
.deposit-wallet-box {
  background: #f8f9fa; padding: 12px; border-radius: 8px;
  margin-top: 15px; border: 1px dashed #007bff;
}
.deposit-flex-row { display: flex; gap: 8px; margin-top: 8px; }
.deposit-flex-row input { flex: 1; padding: 8px; font-size: 13px; }
.deposit-btn-primary {
  width: 100%; background: #28a745; color: white; border: none;
  padding: 12px; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 15px;
}
.deposit-btn-copy {
  background: #007bff; color: white; border: none;
  padding: 8px 15px; border-radius: 6px; cursor: pointer;
}
`;

const styleSheet = document.createElement("style");
styleSheet.innerText = modalStyles;
document.head.appendChild(styleSheet);

// 2. تصميم الواجهة للنافذة
const modalHTML = `
<div id="depositModal" class="deposit-modal-overlay" style="display: none;">
  <div class="deposit-modal-card">
    <button class="deposit-modal-close" onclick="closeDepositModal()">&times;</button>
    
    <h3 style="margin-top:0;">إيداع USDT (TRC20)</h3>
    <p style="font-size:14px; color:#666;">قم بتحويل المبلغ ثم أدخل تفاصيل التحويل</p>

    <!-- عنوان محفظة المنصة الثابتة لاستقبال الإيداعات -->
    <div class="deposit-wallet-box" style="margin-bottom: 15px;">
      <p style="margin:0; font-weight:bold; font-size:13px;">عنوان محفظة الإيداع (TRC20):</p>
      <div class="deposit-flex-row">
        <input type="text" id="platformWalletAddress" value="ضع_عنوان_محفظة_المنصة_هنا" readonly />
        <button type="button" class="deposit-btn-copy" onclick="copyPlatformWallet()">نسخ</button>
      </div>
    </div>

    <form id="depositForm" onsubmit="handleDepositSubmit(event)">
      <div class="deposit-input-group">
        <label for="depositAmount">المبلغ (USDT):</label>
        <input type="number" id="depositAmount" min="10" step="any" placeholder="أدخل المبلغ (مثال: 100)" required />
      </div>

      <div class="deposit-input-group">
        <label for="depositTxHash">رقم المعاملة / Hash (اختياري):</label>
        <input type="text" id="depositTxHash" placeholder="أدخل TxHash أو اتركه فارغاً" />
      </div>

      <div id="depositStatusMessage" style="margin-top:10px; font-size:14px;"></div>

      <button type="submit" id="submitDepositBtn" class="deposit-btn-primary">تأكيد طلب الإيداع</button>
    </form>
  </div>
</div>
`;

document.body.insertAdjacentHTML('beforeend', modalHTML);

// 3. الدوال التشغيلية (Logic & Fetch)
function openDepositModal() {
  document.getElementById('depositModal').style.display = 'flex';
}

function closeDepositModal() {
  document.getElementById('depositModal').style.display = 'none';
  document.getElementById('depositForm').reset();
  document.getElementById('depositStatusMessage').innerText = '';
  document.getElementById('submitDepositBtn').disabled = false;
}

async function handleDepositSubmit(event) {
  event.preventDefault();

  const amountInput = document.getElementById('depositAmount');
  const txHashInput = document.getElementById('depositTxHash');
  const statusMsg = document.getElementById('depositStatusMessage');
  const submitBtn = document.getElementById('submitDepositBtn');

  const amount = parseFloat(amountInput.value);
  const txHash = txHashInput.value.trim();

  if (!amount || amount <= 0) {
    statusMsg.innerText = 'يرجى إدخال مبلغ صحيح.';
    statusMsg.style.color = 'red';
    return;
  }

  submitBtn.disabled = true;
  statusMsg.innerText = 'جاري إرسال طلب الإيداع...';
  statusMsg.style.color = '#333';

  // جلب التوكن الخاص بالمستخدم من التخزين المحلي
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');

  if (!token) {
    statusMsg.innerText = 'يرجى تسجيل الدخول أولاً.';
    statusMsg.style.color = 'red';
    submitBtn.disabled = false;
    return;
  }

  try {
    // تم التعديل إلى المسار الصحيح الموجود في كود السيرفر
    const response = await fetch('/api/wallet/deposit', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        amount: amount,
        txHash: txHash || 'Manual Deposit Request'
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      statusMsg.innerText = data.message || 'تم إرسال طلب الإيداع وهو قيد المراجعة!';
      statusMsg.style.color = 'green';
      setTimeout(() => {
        closeDepositModal();
      }, 2500);
    } else {
      statusMsg.innerText = data.error || data.message || 'حدث خطأ أثناء إرسال الطلب.';
      statusMsg.style.color = 'red';
      submitBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error creating deposit:', error);
    statusMsg.innerText = 'عذراً، تعذر الاتصال بالسيرفر.';
    statusMsg.style.color = 'red';
    submitBtn.disabled = false;
  }
}

function copyPlatformWallet() {
  const walletInput = document.getElementById('platformWalletAddress');
  walletInput.select();
  navigator.clipboard.writeText(walletInput.value);
  alert('تم نسخ عنوان المحفظة بنجاح');
}
