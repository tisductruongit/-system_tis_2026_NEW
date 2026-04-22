/**
 * fontend/admin/js/chat.js
 * Chức năng: WebSocket Chat Client cho Admin
 */

let currentConsultationId = null;
let chatSocket = null;
let currentUser = null;
let reconnectInterval = null; // Biến để quản lý thử lại kết nối

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Lấy thông tin Admin đang đăng nhập
    try {
        currentUser = await fetchAPI('/users/me/');
        if (!['admin', 'super_admin', 'staff'].includes(currentUser.role) && !currentUser.is_superuser) {
            alert("Không có quyền truy cập");
            window.location.href = 'index.html';
            return;
        }
    } catch (e) {
        window.location.href = '../login.html';
        return;
    }

    // 2. Lấy ID từ URL (nếu bấm từ trang consultations chuyển sang)
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');

    // 3. Tải danh sách
    loadConversations(id);
    
    // 4. Bắt sự kiện tìm kiếm trên sidebar
    setupSearchListener();
});

// Setup search functionality
function setupSearchListener() {
    const searchInput = document.querySelector('.msgr-search-container input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterConversations(e.target.value.toLowerCase());
        });
    }
}

function filterConversations(query) {
    const items = document.querySelectorAll('.msgr-item');
    items.forEach(item => {
        const name = item.querySelector('.customer-name');
        if (name && name.textContent.toLowerCase().includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// --- 1. QUẢN LÝ DANH SÁCH HỘI THOẠI ---
async function loadConversations(activeId) {
    const listEl = document.getElementById('conv-list');
    try {
        // Lấy tất cả yêu cầu tư vấn
        // Backend nên có filter chỉ lấy những cái status='processed' hoặc 'new'
        const data = await fetchAPI('/consultations/'); 
        
        if (!data || data.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted mt-5">Chưa có yêu cầu nào.</div>';
            return;
        }

        listEl.innerHTML = data.map(item => {
            const isActive = item.id == activeId ? 'active' : '';
            // Lấy tin nhắn cuối (Backend cần trả về last_message trong serializer)
            const lastMsg = item.last_message ? item.last_message.message : 'Chưa có tin nhắn';
            const time = item.last_message ? item.last_message.time : new Date(item.created_at).toLocaleDateString('vi-VN');
            const avatarLetter = item.customer_name.charAt(0).toUpperCase();
            const relativeTime = getRelativeTime(item.last_message?.created_at || item.created_at);
            
            return `
            <div class="msgr-item ${isActive}" onclick="openChat(${item.id}, '${item.customer_name}')" id="conv-item-${item.id}" data-conversation-id="${item.id}">
                <div class="msgr-avatar">${avatarLetter}</div>
                <div class="flex-grow-1 overflow-hidden">
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="fw-bold text-dark text-truncate customer-name" style="max-width: 140px;">${item.customer_name}</span>
                        <small class="text-muted" style="font-size:0.75rem" title="${new Date(item.last_message?.created_at || item.created_at).toLocaleString('vi-VN')}">${relativeTime}</small>
                    </div>
                    <div class="text-muted small text-truncate" id="last-msg-${item.id}">${lastMsg}</div>
                </div>
            </div>`;
        }).join('');

        // Nếu có ID active thì mở chat luôn
        if (activeId) {
            const activeItem = data.find(i => i.id == activeId);
            if(activeItem) openChat(activeId, activeItem.customer_name);
        }

    } catch (e) { 
        console.error("Lỗi tải hội thoại", e);
        listEl.innerHTML = '<div class="text-danger text-center mt-3">Lỗi tải dữ liệu</div>';
    }
}

// --- 2. MỞ CHAT VÀ KẾT NỐI WEBSOCKET ---
async function openChat(id, name) {
    if (currentConsultationId === id) return; // Đang chat với người này rồi thì thôi

    // Đóng socket cũ nếu có
    if (chatSocket) {
        chatSocket.close();
        clearInterval(reconnectInterval);
    }
    
    currentConsultationId = id;

    // UI Update Header
    document.getElementById('header-name').innerText = name;
    document.getElementById('header-avatar').innerText = name.charAt(0).toUpperCase();
    updateStatus('connecting'); // Cập nhật trạng thái "Đang kết nối..."
    document.getElementById('input-area').style.display = 'flex'; // Hiện khung nhập
    
    // UI Update Active List
    document.querySelectorAll('.msgr-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`conv-item-${id}`);
    if(activeItem) activeItem.classList.add('active');

    // Load Lịch sử Chat (HTTP API)
    await fetchHistory(id);

    // Kết nối WebSocket
    connectWebSocket(id);
}

// Hàm kết nối WebSocket (Có tự động kết nối lại)
/**
 * Kết nối WebSocket với Server
 * @param {number|string} id - ID của cuộc hội thoại (consultation_id)
 */
function connectWebSocket(id) {
    // 1. Tự động nhận diện Protocol (ws hoặc wss) và Host (IP/Domain)
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.hostname || "127.0.0.1";
    // Nếu chạy local thường dùng port 8000, nếu deploy server thật thường chạy port 80/443 (bỏ :8000)
    const port = (host === "127.0.0.1" || host === "localhost") ? ":8000" : "";
    
    const wsUrl = `${protocol}${host}${port}/ws/chat/${id}/`; 

    console.log("🔌 Đang kết nối WebSocket:", wsUrl);
    
    // Đóng socket cũ nếu đang tồn tại trước khi tạo kết nối mới
    if (chatSocket) {
        chatSocket.close();
    }

    chatSocket = new WebSocket(wsUrl);

    // --- XỬ LÝ SỰ KIỆN KẾT NỐI THÀNH CÔNG ---
    chatSocket.onopen = function(e) {
        console.log("✅ Kết nối thành công!");
        updateStatus('online'); // Cập nhật đèn xanh trạng thái
        
        // Xóa bộ đếm kết nối lại nếu có
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    };

    // --- XỬ LÝ KHI NHẬN DỮ LIỆU TỪ SERVER ---
    chatSocket.onmessage = function(e) {
        try {
            const data = JSON.parse(e.data);
            
            // Phân loại xử lý dựa trên "type" mà Backend gửi về
            switch(data.type) {
                case 'typing':
                    showTypingIndicator(); // Hiển thị khách đang soạn tin
                    break;
                case 'stop_typing':
                    hideTypingIndicator(); // Ẩn khi khách ngừng gõ
                    break;
                default:
                    // Đây là tin nhắn văn bản thông thường
                    hideTypingIndicator(); 
                    appendMessage(data); // Vẽ tin nhắn lên màn hình
                    
                    // Cập nhật nội dung tin nhắn cuối cùng ở danh sách bên trái
                    const lastMsgEl = document.getElementById(`last-msg-${id}`);
                    if (lastMsgEl) lastMsgEl.innerText = data.message;
                    break;
            }
        } catch (err) {
            console.error("❌ Lỗi xử lý dữ liệu JSON:", err);
        }
    };

    // --- XỬ LÝ KHI MẤT KẾT NỐI (TỰ ĐỘNG KẾT NỐI LẠI) ---
    chatSocket.onclose = function(e) {
        console.warn("⚠️ WebSocket đã đóng. Đang thử kết nối lại sau 3 giây...");
        updateStatus('offline');
        
        // Chỉ kết nối lại nếu người dùng vẫn đang ở trong phòng chat này
        if (currentConsultationId === id) {
            if (!reconnectInterval) {
                reconnectInterval = setTimeout(() => {
                    reconnectInterval = null;
                    connectWebSocket(id);
                }, 3000);
            }
        }
    };

    // --- XỬ LÝ LỖI ---
    chatSocket.onerror = function(err) {
        console.error("❌ Lỗi kết nối WebSocket:", err);
        chatSocket.close(); // Kích hoạt sự kiện onclose để chạy logic kết nối lại
    };
}

// Helper cập nhật trạng thái online/offline
function updateStatus(state) {
    const el = document.getElementById('header-status');
    if (state === 'online') {
        el.innerHTML = '<i class="fas fa-circle x-small text-success"></i> Trực tuyến';
    } else if (state === 'connecting') {
        el.innerHTML = '<i class="fas fa-circle x-small text-warning"></i> Đang kết nối...';
    } else {
        el.innerHTML = '<i class="fas fa-circle x-small text-secondary"></i> Mất kết nối';
    }
}

// --- 3. XỬ LÝ HIỂN THỊ TIN NHẮN ---
async function fetchHistory(id) {
    const box = document.getElementById('message-box');
    box.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
    
    try {
        // Gọi API lấy lịch sử (đã tạo ở Backend bước trước)
        const msgs = await fetchAPI(`/consultations/${id}/messages/`);
        
        if(msgs.length === 0) {
            box.innerHTML = '<div class="text-center text-muted mt-5"><p>Bắt đầu hỗ trợ khách hàng ngay.</p></div>';
            return;
        }
        
        box.innerHTML = ''; // Xóa loading
        msgs.forEach(m => {
            // Map dữ liệu từ API sang format chung
            const formattedMsg = {
                message: m.message,
                is_staff_reply: m.is_staff_reply,
                created_at: new Date(m.created_at).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}),
                sender_name: m.sender_name,
                avatar: m.avatar
            };
            appendMessage(formattedMsg);
        });
        
        // Cuộn xuống đáy sau khi load xong
        scrollToBottom();

    } catch (e) { 
        console.error(e);
        box.innerHTML = '<div class="text-danger text-center">Không thể tải lịch sử chat.</div>';
    }
}
function appendMessage(data) {
    const box = document.getElementById('message-box');
    const isMe = data.is_staff_reply; // Admin/Staff luôn là 'Me' (bên phải)
    
    const alignClass = isMe ? 'msg-right' : 'msg-left';
    const justifyClass = isMe ? 'justify-content-end' : 'justify-content-start';
    
    // 1. Logic Avatar cho khách hàng (bên trái)
    const avatarLetter = data.sender_name ? data.sender_name.charAt(0).toUpperCase() : 'K';
    const avatarHtml = !isMe 
        ? `<div class="msgr-avatar bg-light text-dark me-2" style="width:28px;height:28px;font-size:0.8rem;font-weight:bold">${avatarLetter}</div>` 
        : '';
    
    // 2. Logic hiển thị Tên (Chỉ hiển thị nếu là người khác và khác với tin nhắn liền trước)
    const lastMessage = box.lastElementChild;
    const shouldShowName = !lastMessage || 
                           lastMessage.dataset.sender !== String(data.sender_name) || 
                           lastMessage.dataset.isstaff !== String(isMe);
                           
    const nameHtml = (shouldShowName && !isMe) 
        ? `<small class="text-muted text-truncate ms-2 mb-1" style="font-size:0.7rem; max-width:150px;">${data.sender_name || 'Khách hàng'}</small>` 
        : '';
    
    // 3. Logic Nội dung: Xử lý Text & Tệp đính kèm
    let contentHtml = '';
    
    // Nếu có chữ (hỗ trợ xuống dòng bằng cách thay \n thành <br>)
    if (data.message) {
        // Escape HTML để chống XSS (bảo mật)
        const safeText = data.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml += `<div class="msg-text">${safeText.replace(/\n/g, '<br>')}</div>`;
    }

    // Nếu có file đính kèm
    if (data.attachment_url) {
        const marginClass = data.message ? 'mt-2' : ''; // Nếu có cả text thì cách ra 1 chút
        
        if (data.attachment_type === 'image') {
            contentHtml += `
                <div class="${marginClass}">
                    <a href="${data.attachment_url}" target="_blank" title="Bấm để xem ảnh lớn">
                        <img src="${data.attachment_url}" alt="Image" style="max-width: 220px; max-height: 250px; border-radius: 8px; object-fit: cover;">
                    </a>
                </div>`;
        } else {
            // Hiển thị dạng file document/khác
            const linkColor = isMe ? 'text-white' : 'text-primary';
            contentHtml += `
                <div class="${marginClass} p-2 rounded d-flex align-items-center gap-2" style="background: rgba(0,0,0,0.05);">
                    <i class="fas fa-file-alt fs-4 ${linkColor}"></i>
                    <a href="${data.attachment_url}" target="_blank" class="${linkColor} text-decoration-none fw-bold" style="font-size: 0.85rem;">
                        Tệp đính kèm
                    </a>
                </div>`;
        }
    }
    
    if (!contentHtml) contentHtml = '<i class="text-muted">Tin nhắn không có nội dung</i>';

    // 4. Logic Trạng thái đã gửi / đã xem (Dành cho Admin)
    let statusHtml = '';
    if (isMe) {
        if (data.is_read) {
            statusHtml = `<span class="text-success ms-1" style="font-size:0.75rem;" title="Khách đã xem">✓✓</span>`;
        } else {
            statusHtml = `<span class="text-white-50 ms-1" style="font-size:0.75rem;" title="Đã gửi">✓</span>`;
        }
    }

    // 5. Build HTML cuối cùng
    const html = `
    <div class="d-flex w-100 ${justifyClass} mb-2 animate-fade-in" data-sender="${data.sender_name}" data-isstaff="${isMe}">
         ${avatarHtml}
         <div class="d-flex flex-column align-items-${isMe ? 'end' : 'start'}" style="max-width: 75%;">
            ${nameHtml}
            <div class="msg-bubble ${alignClass}" title="${data.sender_name || 'Hệ thống'} • ${data.created_at}">
                ${contentHtml}
                
                <div class="d-flex align-items-center justify-content-end mt-1 gap-1" style="opacity: 0.8;">
                    <small style="font-size:0.65rem;">${data.created_at}</small>
                    ${statusHtml}
                </div>
            </div>
         </div>
    </div>`;

    // 6. Dọn dẹp Box & Thêm tin nhắn
    // Xóa empty state hoặc spinner loading nếu có
    const emptyState = box.querySelector('.msgr-empty');
    if(emptyState) emptyState.remove();
    
    const loadingSpinner = box.querySelector('.spinner-border');
    if (loadingSpinner) box.innerHTML = '';

    box.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

let typingTimeout = null;
function showTypingIndicator() {
    clearTimeout(typingTimeout);
    const box = document.getElementById('message-box');
    let indicator = box.querySelector('.typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'typing-indicator d-flex align-items-center gap-2';
        indicator.innerHTML = `
            <div class="msgr-avatar text-dark" style="width:28px;height:28px;font-size:0.8rem;font-weight:bold">K</div>
            <div class="msg-bubble msg-left">
                <span></span><span></span><span></span>
            </div>
        `;
        box.appendChild(indicator);
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        const indicator = document.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
    }, 200);
}

function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return diffMins + 'p';
    if (diffHours < 24) return diffHours + 'h';
    if (diffDays === 1) return 'Hôm qua';
    if (diffDays < 7) return diffDays + 'd';
    return date.toLocaleDateString('vi-VN');
}

function scrollToBottom() {
    const box = document.getElementById('message-box');
    box.scrollTop = box.scrollHeight;
}

// --- 4. GỬI TIN NHẮN ---
let typingSent = false;
function sendMessage() {
    const input = document.getElementById('msg-input');
    const message = input.value.trim();
    
    if (!message) return;

    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
        // Fallback: Nếu socket chưa sẵn sàng, có thể báo lỗi hoặc thử gửi qua API HTTP (tùy chọn)
        alert("Mất kết nối! Đang thử kết nối lại...");
        return;
    }

    // Gửi qua WebSocket
    chatSocket.send(JSON.stringify({
        'message': message,
        'sender_id': currentUser.id, // ID của Admin đang login
        'is_staff': true // Cờ báo hiệu đây là Staff
    }));
    
    // Gửi stop_typing nếu cần
    if (typingSent) {
        chatSocket.send(JSON.stringify({ type: 'stop_typing' }));
        typingSent = false;
    }

    input.value = '';
    input.focus();
}

// Gửi typing indicator khi người dùng đang gõ
document.addEventListener('DOMContentLoaded', () => {
    const msgInput = document.getElementById('msg-input');
    if (msgInput) {
        msgInput.addEventListener('input', () => {
            if (!typingSent && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({ type: 'typing' }));
                typingSent = true;
            }
        });
    }
});

function handleEnter(e) {
    if(e.key === 'Enter') sendMessage();
}

// CSS Animation nhúng (để tin nhắn hiện mượt hơn) + Typing indicator animation
const style = document.createElement('style');
style.innerHTML = `
    .animate-fade-in { 
        animation: fadeIn 0.3s ease-in; 
    } 
    @keyframes fadeIn { 
        from { opacity:0; transform: translateY(10px); } 
        to { opacity:1; transform: translateY(0); } 
    }
    .typing-indicator span {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #999;
        display: inline-block;
        animation: typing 1.4s infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing {
        0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-10px); }
    }
`;
document.head.appendChild(style);

