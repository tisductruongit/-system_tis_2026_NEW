/**
 * TIS System - Chat Widget cho Khách hàng (User)
 */

document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ Chat Widget script đã khởi chạy!");

    // --- CẤU HÌNH BIẾN TOÀN CỤC ---
    let chatSocket = null;
    let consultationId = localStorage.getItem('current_consultation_id');
    let customerName = localStorage.getItem('chat_customer_name') || "Khách hàng";
    
    // Tự động nhận diện IP/Domain đang chạy thay vì fix cứng 127.0.0.1
    const currentHost = window.location.hostname || "127.0.0.1";
    const API_BASE_URL = `http://${currentHost}:8000/api`;
    const WS_BASE_URL = window.location.protocol === "https:" ? `wss://${currentHost}:8000/ws` : `ws://${currentHost}:8000/ws`;

    // ==========================================
    // 1. LẮNG NGHE SỰ KIỆN CLICK (Mở/Đóng chat)
    // ==========================================
    document.addEventListener('click', (e) => {
        const launcherBtn = e.target.closest('#chat-widget-btn');
        if (launcherBtn) {
            e.preventDefault();
            const widgetWindow = document.getElementById('chat-widget-window');
            if (widgetWindow) {
                widgetWindow.classList.toggle('d-none');
                if (!widgetWindow.classList.contains('d-none')) checkCurrentSession();
            }
            return;
        }

        const closeBtn = e.target.closest('#close-chat-btn');
        if (closeBtn) {
            e.preventDefault();
            const widgetWindow = document.getElementById('chat-widget-window');
            if (widgetWindow) widgetWindow.classList.add('d-none');
            return;
        }

        const sendBtn = e.target.closest('#chat-widget-send-btn');
        if (sendBtn) {
            e.preventDefault();
            sendTextMessage();
            return;
        }
    });

    // ==========================================
    // 2. LẮNG NGHE SỰ KIỆN SUBMIT FORM (QUAN TRỌNG: FIX LỖI TẠO PHIÊN)
    // ==========================================
    document.addEventListener('submit', async (e) => {
        const startForm = e.target.closest('#start-consultation-form');
        if (startForm) {
            e.preventDefault();
            
            const nameEl = document.getElementById('chat-customer-name');
            const phoneEl = document.getElementById('chat-customer-phone');
            const noteEl = document.getElementById('chat-customer-note');
            const submitBtn = startForm.querySelector('button[type="submit"]');

            const name = nameEl.value.trim();
            const phone = phoneEl.value.trim();
            const note = noteEl ? noteEl.value.trim() : '';

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Đang kết nối...';

            try {
                // FIX: Đổi từ 'full_name' thành 'customer_name' cho khớp với Backend
                const payloadData = { 
                    customer_name: name,  
                    phone: phone, 
                    note: note, 
                    status: 'new' // Đổi 'pending' thành 'new' thường dùng trong model Django
                };

                console.log("Đang gửi dữ liệu tạo Chat lên API:", payloadData);

                const res = await fetch(`${API_BASE_URL}/consultations/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadData)
                });

                // Xử lý báo lỗi chi tiết nếu Backend từ chối
                if (!res.ok) {
                    const errorData = await res.json();
                    console.error("Lỗi từ Backend:", errorData);
                    throw new Error(JSON.stringify(errorData));
                }
                
                const data = await res.json();
                
                if (data.id) {
                    consultationId = data.id;
                    customerName = name;
                    
                    localStorage.setItem('current_consultation_id', consultationId);
                    localStorage.setItem('chat_customer_name', customerName);
                    
                    startForm.reset();
                    checkCurrentSession();
                }
            } catch (err) {
                console.error("Lỗi bắt được:", err);
                alert("Không thể bắt đầu chat do API từ chối. Vui lòng mở F12 -> Console để xem lỗi đỏ!");
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Bắt đầu chat';
            }
        }
    });

    // ==========================================
    // 3. NHẤN ENTER ĐỂ GỬI & FILE UPLOAD
    // ==========================================
    document.addEventListener('keypress', (e) => {
        if (e.target && e.target.id === 'chat-widget-input-text' && e.key === 'Enter') {
            e.preventDefault();
            sendTextMessage();
        }
    });

    document.addEventListener('change', async (e) => {
        if (e.target && e.target.id === 'chat-file-upload') {
            alert("Tính năng gửi file đang được hoàn thiện!");
            e.target.value = ''; 
        }
    });

    // ==========================================
    // 4. CÁC HÀM XỬ LÝ GIAO DIỆN CHAT & WEBSOCKET
    // ==========================================
    function checkCurrentSession() {
        const formView = document.getElementById('chat-widget-form');
        const conversationView = document.getElementById('chat-widget-conversation');
        
        if (!formView || !conversationView) return;

        if (consultationId) {
            formView.classList.add('d-none');
            conversationView.classList.remove('d-none');
            conversationView.classList.add('d-flex');
            
            if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
                connectWebSocket(consultationId);
                fetchChatHistory(consultationId);
            }
        } else {
            formView.classList.remove('d-none');
            conversationView.classList.add('d-none');
            conversationView.classList.remove('d-flex');
        }
    }

    function connectWebSocket(id) {
        const wsUrl = `${WS_BASE_URL}/chat/${id}/`;
        console.log("Đang kết nối WebSocket tới:", wsUrl);
        
        chatSocket = new WebSocket(wsUrl);

        chatSocket.onopen = function() {
            console.log("✅ Kết nối WebSocket thành công!");
        };

        chatSocket.onmessage = function(e) {
            const data = JSON.parse(e.data);
            if (data.type === 'typing' || data.type === 'stop_typing') return;
            appendWidgetMessage(data);
        };

        chatSocket.onclose = function(e) {
            console.warn('⚠️ Mất kết nối WebSocket. Đang tự động thử lại sau 3s...');
            setTimeout(() => {
                const widgetWindow = document.getElementById('chat-widget-window');
                if (widgetWindow && !widgetWindow.classList.contains('d-none')) {
                    connectWebSocket(consultationId);
                }
            }, 3000);
        };
    }

    async function fetchChatHistory(id) {
        try {
            const res = await fetch(`${API_BASE_URL}/consultations/${id}/messages/`);
            if (!res.ok) return;
            
            const msgs = await res.json();
            const msgBox = document.getElementById('chat-widget-messages');
            
            if (msgs.length > 0 && msgBox) {
                msgBox.innerHTML = ''; 
                msgs.forEach(m => {
                    appendWidgetMessage({
                        message: m.message,
                        is_staff_reply: m.is_staff_reply,
                        attachment_url: m.attachment,
                        attachment_type: m.attachment_type,
                        created_at: new Date(m.created_at).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})
                    });
                });
            }
        } catch (e) { console.error("Lỗi lấy lịch sử chat:", e); }
    }

    function appendWidgetMessage(data) {
        const msgBox = document.getElementById('chat-widget-messages');
        if (!msgBox) return;

        const isMe = !data.is_staff_reply; 
        let contentHtml = '';

        if (data.message) {
            const safeText = data.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            contentHtml += `<div>${safeText.replace(/\n/g, '<br>')}</div>`;
        }

        if (data.attachment_url) {
            const fileUrl = data.attachment_url.startsWith('http') ? data.attachment_url : `http://${currentHost}:8000${data.attachment_url}`;
            if (data.attachment_type === 'image') {
                contentHtml += `<div class="${data.message ? 'mt-1' : ''}"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" style="max-width: 100%; border-radius: 8px;"></a></div>`;
            } else {
                contentHtml += `<div class="${data.message ? 'mt-1' : ''}"><a href="${fileUrl}" target="_blank" style="color: inherit; text-decoration: underline;"><i class="fas fa-file-alt"></i> Tệp đính kèm</a></div>`;
            }
        }

        const alignClass = isMe ? 'widget-msg-right' : 'widget-msg-left';
        const html = `
            <div class="widget-msg ${alignClass} animate-fade-in" style="animation: fadeIn 0.3s ease-in-out;">
                ${contentHtml}
                <div class="text-end" style="font-size: 10px; opacity: 0.7; margin-top: 3px;">
                    ${data.created_at || new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})}
                </div>
            </div>`;
            
        const initialText = msgBox.querySelector('.text-center.text-muted');
        if (initialText) initialText.remove();

        msgBox.insertAdjacentHTML('beforeend', html);
        msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
    }

    function sendTextMessage() {
        const inputEl = document.getElementById('chat-widget-input-text');
        if (!inputEl) return;
        
        const text = inputEl.value.trim();

        if (text && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({
                'message': text,
                'sender_name': customerName,
                'is_staff': false 
            }));
            
            inputEl.value = ''; 
            inputEl.focus();
        }
    }
});