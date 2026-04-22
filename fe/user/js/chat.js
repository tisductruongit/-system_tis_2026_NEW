let activeConsultationId = null;
let chatSocket = null; // Thêm biến quản lý Socket
let userInfo = null;

document.addEventListener("DOMContentLoaded", async () => {
    if (!getAccessToken()) {
        window.location.href = '../login.html';
        return;
    }
    // Lấy thông tin user để gửi kèm WebSocket
    try {
        userInfo = await fetchAPI('/users/me/');
        loadConsultations();
    } catch (e) {
        window.location.href = '../login.html';
    }
});

// ... (Giữ nguyên hàm loadConsultations) ...

window.openChat = async function(consultationId, status) {
    activeConsultationId = consultationId;
    
    document.getElementById('chat-title').innerText = `Phiên tư vấn #${consultationId}`;
    document.getElementById('chat-status').innerText = status === 'new' ? 'Chuyên viên đang chuẩn bị phản hồi...' : 'Chuyên viên đang hỗ trợ';
    document.getElementById('chat-form').style.display = 'flex';
    
    document.querySelectorAll('.chat-ticket').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');

    // 1. Tải lịch sử chat cũ bằng API HTTP
    await loadMessagesHistory();
    
    // 2. Kết nối WebSocket (Thay thế cho Polling 3s cũ)
    connectWebSocket(consultationId);
}

// Tách hàm load lịch sử riêng
async function loadMessagesHistory() {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-primary spinner-border-sm"></div></div>';
    
    try {
        const messages = await fetchAPI(`/consultations/${activeConsultationId}/messages/`, 'GET');
        chatBox.innerHTML = '';
        if (messages.length === 0) {
            chatBox.innerHTML = `<div class="text-center text-muted mt-4">Bắt đầu cuộc trò chuyện.</div>`;
            return;
        }
        messages.forEach(msg => appendMessageToDOM(msg));
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (e) {
        chatBox.innerHTML = `<div class="text-center text-danger mt-4">Lỗi tải tin nhắn.</div>`;
    }
}

// Hàm kết nối Socket
function connectWebSocket(id) {
    if (chatSocket) chatSocket.close(); // Đóng kết nối cũ nếu đổi phòng chat

    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.hostname || "127.0.0.1";
    const port = (host === "127.0.0.1" || host === "localhost") ? ":8000" : "";
    
    chatSocket = new WebSocket(`${protocol}${host}${port}/ws/chat/${id}/`);

    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);
        if (data.type === 'typing' || data.type === 'stop_typing') return;
        
        appendMessageToDOM(data);
        const chatBox = document.getElementById('chat-box');
        chatBox.scrollTop = chatBox.scrollHeight;
    };

    chatSocket.onclose = function() {
        console.warn("Mất kết nối WebSocket. Đang thử lại...");
        setTimeout(() => connectWebSocket(id), 3000);
    };
}

// Hàm render UI (Chỉ render khi nhận được từ Server trả về, không render ảo)
function appendMessageToDOM(msg) {
    const chatBox = document.getElementById('chat-box');
    const isUser = !msg.is_staff_reply;
    const time = msg.created_at.includes(':') ? msg.created_at : new Date(msg.created_at).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
    
    // Xóa chữ "Bắt đầu cuộc trò chuyện" nếu có
    const emptyText = chatBox.querySelector('.text-muted');
    if (emptyText) emptyText.remove();

    chatBox.insertAdjacentHTML('beforeend', `
        <div class="d-flex flex-column animate-fade-in">
            <div class="msg-bubble ${isUser ? 'msg-user' : 'msg-staff'} shadow-sm">
                ${msg.message || '[Tệp đính kèm]'}
            </div>
            <small class="text-muted ${isUser ? 'text-end' : 'text-start'} mb-3" style="font-size: 0.65rem; margin-top: -10px; padding: 0 5px;">
                ${isUser ? 'Bạn' : 'TIS Broker'} • ${time}
            </small>
        </div>
    `);
}

// Gửi tin nhắn qua WebSocket thay vì HTTP API
window.sendMessage = function(e) {
    e.preventDefault();
    if (!activeConsultationId || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;

    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    // Gửi lên Server qua WebSocket (Không render ảo nữa để chống mất tin nhắn)
    chatSocket.send(JSON.stringify({
        message: text,
        sender_id: userInfo.id,
        sender_name: `${userInfo.last_name} ${userInfo.first_name}`.trim(),
        is_staff: false
    }));

    input.value = '';
    input.focus();
}