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
    <p style="font-size:14px; color:#666;">أدخل المبلغ المطلوب للحصول على عنوان المحفظة</p>

    <form id="depositForm" onsubmit="handleDepositSubmit(event)">
      <div class="deposit-input-group">
        <label for="depositAmount">المبلغ (USDT):</label>
        <input type="number" id="depositAmount" min="10" step="any" placeholder="أدخل المبلغ (مثال: 100)" required />
      </div>

      <div id="walletAddressContainer" class="deposit-wallet-box" style="display: none;">
        <p style="margin:0; font-weight:bold; font-size:13px;">قم بتحويل المبلغ إلى العنوان التالي:</p>
        <div class="deposit-flex-row">
          <input type="text" id="walletAddressInput" readonly />
          <button type="button" class="deposit-btn-copy" onclick="copyWalletAddress()">نسخ</button>
        </div>
        <p style="font-size:11px; color:#d9534f; margin: 6px 0 0 0;">ملاحظة: التأكيد يتم تلقائياً عبر البلوكشين فور وصول التحويل.</p>
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
  document.getElementById('walletAddressContainer').style.display = 'none';
  document.getElementById('depositStatusMessage').innerText = '';
  document.getElementById('submitDepositBtn').disabled = false;
}

async function handleDepositSubmit(event) {
  event.preventDefault();

  const amountInput = document.getElementById('depositAmount');
  const statusMsg = document.getElementById('depositStatusMessage');
  const submitBtn = document.getElementById('submitDepositBtn');
  const walletContainer = document.getElementById('walletAddressContainer');
  const walletInput = document.getElementById('walletAddressInput');

  const amount = parseFloat(amountInput.value);

  if (!amount || amount <= 0) {
    statusMsg.innerText = 'يرجى إدخال مبلغ صحيح.';
    statusMsg.style.color = 'red';
    return;
  }

  submitBtn.disabled = true;
  statusMsg.innerText = 'جاري إنشاء طلب الإيداع...';
  statusMsg.style.color = '#333';

  try {
    const response = await fetch('/api/deposit/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      statusMsg.innerText = 'تم إنشاء الطلب بنجاح!';
      statusMsg.style.color = 'green';
      walletInput.value = data.walletAddress;
      walletContainer.style.display = 'block';
    } else {
      statusMsg.innerText = data.message || 'حدث خطأ أثناء إنشاء الطلب.';
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

function copyWalletAddress() {
  const walletInput = document.getElementById('walletAddressInput');
  walletInput.select();
  navigator.clipboard.writeText(walletInput.value);
  alert('تم نسخ عنوان المحفظة بنجاح');
}
