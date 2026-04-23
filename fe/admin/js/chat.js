/**
 * fontend/admin/js/chat.js
 * Chức năng: WebSocket Chat Client cho Admin
 */

let currentConsultationId = null;
let chatSocket = null;
let currentUser = null;
let reconnectInterval = null;

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
        const data = await fetchAPI('/consultations/'); 
        
        if (!data || data.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted mt-5">Chưa có yêu cầu nào.</div>';
            return;
        }

        listEl.innerHTML = data.map(item => {
            const isActive = item.id == activeId ? 'active' : '';
            const lastMsg = item.last_message ? item.last_message.message : 'Chưa có tin nhắn';
            const relativeTime = getRelativeTime(item.last_message?.created_at || item.created_at);
            const avatarLetter = item.customer_name.charAt(0).toUpperCase();
            
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
    if (currentConsultationId === id) return; 

    if (chatSocket) {
        chatSocket.close();
        clearInterval(reconnectInterval);
    }
    
    currentConsultationId = id;

    // UI Update Header
    document.getElementById('header-name').innerText = name;
    document.getElementById('header-avatar').innerText = name.charAt(0).toUpperCase();
    updateStatus('connecting'); 
    document.getElementById('input-area').style.display = 'flex'; 
    
    // UI Update Active List
    document.querySelectorAll('.msgr-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`conv-item-${id}`);
    if(activeItem) activeItem.classList.add('active');

    await fetchHistory(id);
    connectWebSocket(id);
}

function connectWebSocket(id) {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.hostname || "127.0.0.1";
    const port = (host === "127.0.0.1" || host === "localhost") ? ":8000" : "";
    
    const wsUrl = `${protocol}${host}${port}/ws/chat/${id}/`; 

    if (chatSocket) {
        chatSocket.close();
    }

    chatSocket = new WebSocket(wsUrl);

    chatSocket.onopen = function(e) {
        updateStatus('online'); 
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    };

    chatSocket.onmessage = function(e) {
        try {
            const data = JSON.parse(e.data);
            
            switch(data.type) {
                case 'typing':
                    if (!data.is_staff) showTypingIndicator(); 
                    break;
                case 'stop_typing':
                    if (!data.is_staff) hideTypingIndicator(); 
                    break;
                default:
                    hideTypingIndicator(); 
                    appendMessage(data); 
                    
                    const lastMsgEl = document.getElementById(`last-msg-${id}`);
                    if (lastMsgEl) {
                        lastMsgEl.innerText = data.message || '[Tệp đính kèm]';
                    }
                    break;
            }
        } catch (err) {
            console.error("Lỗi xử lý dữ liệu JSON:", err);
        }
    };

    chatSocket.onclose = function(e) {
        updateStatus('offline');
        if (currentConsultationId === id) {
            if (!reconnectInterval) {
                reconnectInterval = setTimeout(() => {
                    reconnectInterval = null;
                    connectWebSocket(id);
                }, 3000);
            }
        }
    };

    chatSocket.onerror = function(err) {
        chatSocket.close(); 
    };
}

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
        const msgs = await fetchAPI(`/consultations/${id}/messages/`);
        
        if(msgs.length === 0) {
            box.innerHTML = '<div class="text-center text-muted mt-5"><p>Bắt đầu hỗ trợ khách hàng ngay.</p></div>';
            return;
        }
        
        box.innerHTML = ''; 
        msgs.forEach(m => {
            const formattedMsg = {
                message: m.message,
                is_staff_reply: m.is_staff_reply,
                created_at: new Date(m.created_at).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}),
                sender_name: m.sender_name,
                avatar: m.avatar,
                // BỔ SUNG 2 DÒNG DƯỚI ĐÂY:
                attachment_url: m.attachment_url, 
                attachment_type: m.attachment_type
            };
            appendMessage(formattedMsg);
        });
        
        scrollToBottom();

    } catch (e) { 
        box.innerHTML = '<div class="text-danger text-center">Không thể tải lịch sử chat.</div>';
    }
}

function appendMessage(data) {
    const box = document.getElementById('message-box');
    const isMe = data.is_staff_reply !== undefined ? data.is_staff_reply : data.is_staff;
    
    const alignClass = isMe ? 'msg-right' : 'msg-left';
    const justifyClass = isMe ? 'justify-content-end' : 'justify-content-start';
    
    const avatarLetter = data.sender_name ? data.sender_name.charAt(0).toUpperCase() : 'K';
    const avatarHtml = !isMe 
        ? `<div class="msgr-avatar bg-light text-dark me-2 flex-shrink-0 mt-1" style="width:28px;height:28px;font-size:0.8rem;font-weight:bold">${avatarLetter}</div>` 
        : '';
    
    const lastMessage = box.lastElementChild;
    const shouldShowName = !lastMessage || 
                           lastMessage.dataset.sender !== String(data.sender_name) || 
                           lastMessage.dataset.isstaff !== String(isMe);
                           
    const nameHtml = (shouldShowName && !isMe) 
        ? `<small class="text-muted text-truncate ms-2 mb-1" style="font-size:0.7rem; max-width:150px;">${data.sender_name || 'Khách hàng'}</small>` 
        : '';
    
    let contentHtml = '';
    
    if (data.message) {
        const safeText = data.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml += `<div class="msg-text">${safeText.replace(/\n/g, '<br>')}</div>`;
    }

    if (data.attachment_url) {
        const marginClass = data.message ? 'mt-2' : ''; 
        
        if (data.attachment_type === 'image') {
            contentHtml += `
                <div class="${marginClass}">
                    <a href="${data.attachment_url}" target="_blank" title="Bấm để xem ảnh lớn">
                        <img src="${data.attachment_url}" alt="Image" style="max-width: 220px; max-height: 250px; border-radius: 8px; object-fit: cover;">
                    </a>
                </div>`;
        } else {
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

    let statusHtml = '';
    if (isMe) {
        if (data.is_read) {
            statusHtml = `<span class="text-success ms-1" style="font-size:0.75rem;" title="Khách đã xem">✓✓</span>`;
        } else {
            statusHtml = `<span class="text-white-50 ms-1" style="font-size:0.75rem;" title="Đã gửi">✓</span>`;
        }
    }

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
    let indicator = box.querySelector('.typing-indicator-wrapper');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'typing-indicator-wrapper d-flex w-100 justify-content-start mb-2 animate-fade-in align-items-end';
        indicator.innerHTML = `
            <div class="msgr-avatar bg-light text-dark me-2 flex-shrink-0 mt-1" style="width:28px;height:28px;font-size:0.8rem;font-weight:bold">K</div>
            <div class="msg-bubble msg-left d-flex align-items-center gap-1" style="padding: 12px 16px; margin-bottom: 0; background: #e4e6eb; border-radius: 18px;">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
        `;
        box.appendChild(indicator);
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        const indicator = document.querySelector('.typing-indicator-wrapper');
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
        alert("Mất kết nối! Đang thử kết nối lại...");
        return;
    }

    chatSocket.send(JSON.stringify({
        'message': message,
        'sender_id': currentUser.id, 
        'is_staff': true 
    }));
    
    if (typingSent) {
        chatSocket.send(JSON.stringify({ type: 'stop_typing', is_staff: true }));
        typingSent = false;
    }

    input.value = '';
    input.focus();
}

// =========================================================
// TÍNH NĂNG UPLOAD FILE & ẢNH (DÀNH CHO ADMIN)
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Tạo thẻ input file ẩn nếu chưa có
    if (!document.getElementById('chat-file-upload')) {
        document.body.insertAdjacentHTML('beforeend', `
            <input type="file" id="chat-file-upload" style="display: none;" accept="image/*, .pdf, .doc, .docx, .xls, .xlsx, .zip, .rar">
        `);
    }

    const fileInput = document.getElementById('chat-file-upload');

    // 2. Gắn sự kiện click cho các icon Thêm file / Gửi ảnh của Admin
    const attachIcons = document.querySelectorAll('.msgr-footer-icons .fa-plus-circle, .msgr-footer-icons .fa-image');
    attachIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
                alert("Vui lòng kết nối vào phòng chat trước khi gửi file!");
                return;
            }
            fileInput.click();
        });
    });

    // 3. Xử lý khi Admin đã chọn file xong
    fileInput.addEventListener('change', async function() {
        const file = this.files[0];
        if (!file) return;

        // Reset value để có thể chọn lại file giống hệt sau đó
        this.value = '';

        if (file.size > 5 * 1024 * 1024) {
            alert("File quá lớn. Vui lòng chọn file dưới 5MB.");
            return;
        }

        // Bật trạng thái loading
        const msgInput = document.getElementById('msg-input');
        const oldPlaceholder = msgInput.placeholder || 'Aa';
        msgInput.placeholder = "Đang tải file...";
        msgInput.disabled = true;

        const formData = new FormData();
        formData.append('file', file);

        try {
            // Gọi API lưu file
            const BASE_URL = 'http://127.0.0.1:8000'; 
            const response = await fetch(`${BASE_URL}/api/chat/upload/`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.attachment_url) {
                // Phát sóng URL qua WebSocket (Dùng currentUser và is_staff: true cho Admin)
                chatSocket.send(JSON.stringify({
                    'message': '', 
                    'sender_id': currentUser.id, 
                    'is_staff': true,
                    'attachment_url': data.attachment_url,
                    'attachment_type': data.attachment_type
                }));
            } else {
                alert("Không nhận được phản hồi file từ Server.");
            }
        } catch (error) {
            console.error("Lỗi upload file:", error);
            alert("Đã xảy ra lỗi khi tải file lên hệ thống.");
        } finally {
            // Tắt trạng thái loading
            msgInput.placeholder = oldPlaceholder;
            msgInput.disabled = false;
            msgInput.focus();
        }
    });
});

function handleEnter(e) {
    if(e.key === 'Enter') sendMessage();
}

// CSS Animation nhúng
const style = document.createElement('style');
style.innerHTML = `
    .animate-fade-in { animation: fadeIn 0.3s ease-in; } 
    @keyframes fadeIn { 
        from { opacity:0; transform: translateY(10px); } 
        to { opacity:1; transform: translateY(0); } 
    }
    .typing-indicator-wrapper .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #8e8e8e;
        display: inline-block;
        animation: typing-dots 1.4s infinite;
    }
    .typing-indicator-wrapper .dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator-wrapper .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing-dots {
        0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-5px); }
    }
`;
document.head.appendChild(style);