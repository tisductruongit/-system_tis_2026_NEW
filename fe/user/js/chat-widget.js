/**
 * TIS System - Chat Widget cho khach hang (User)
 */

function initChatWidget() {
    if (window.__chatWidgetInitialized) return;
    window.__chatWidgetInitialized = true;

    console.log("Chat Widget script da khoi chay");

    let chatSocket = null;
    let consultationId = localStorage.getItem('current_consultation_id');
    let customerName = localStorage.getItem('chat_customer_name') || "Khach hang";

    const currentHost = window.location.hostname || "127.0.0.1";
    const apiBaseUrl = `http://${currentHost}:8000/api`;
    const wsBaseUrl = window.location.protocol === "https:"
        ? `wss://${currentHost}:8000/ws`
        : `ws://${currentHost}:8000/ws`;

    document.addEventListener('click', (e) => {
        const launcherBtn = e.target.closest('#chat-widget-btn') || e.target.closest('#chatIcon');
        if (launcherBtn) {
            e.preventDefault();
            const widgetWindow = document.getElementById('chat-widget-window');
            if (widgetWindow) {
                widgetWindow.classList.toggle('d-none');
                if (!widgetWindow.classList.contains('d-none')) {
                    checkCurrentSession();
                }
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
        }
    });

    document.addEventListener('submit', async (e) => {
        const startForm = e.target.closest('#start-consultation-form');
        if (!startForm) return;

        e.preventDefault();

        const nameEl = document.getElementById('chat-customer-name');
        const phoneEl = document.getElementById('chat-customer-phone');
        const noteEl = document.getElementById('chat-customer-note');
        const submitBtn = startForm.querySelector('button[type="submit"]');

        const name = nameEl?.value.trim() || '';
        const phone = phoneEl?.value.trim() || '';
        const note = noteEl?.value.trim() || '';

        if (!name || !phone) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Dang ket noi...';

        try {
            const payloadData = {
                customer_name: name,
                phone: phone,
                note: note,
                status: 'new'
            };

            const res = await fetch(`${apiBaseUrl}/consultations/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadData)
            });

            if (!res.ok) {
                const errorData = await res.json();
                console.error("Loi tu Backend:", errorData);
                throw new Error(JSON.stringify(errorData));
            }

            const data = await res.json();
            if (data.id) {
                consultationId = String(data.id);
                customerName = name;

                localStorage.setItem('current_consultation_id', consultationId);
                localStorage.setItem('chat_customer_name', customerName);

                startForm.reset();
                checkCurrentSession();
            }
        } catch (err) {
            console.error("Loi bat duoc:", err);
            alert("Khong the bat dau chat. Vui long kiem tra API consultation.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Bat dau chat';
        }
    });

    document.addEventListener('keypress', (e) => {
        if (e.target && e.target.id === 'chat-widget-input-text' && e.key === 'Enter') {
            e.preventDefault();
            sendTextMessage();
        }
    });

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
        const wsUrl = `${wsBaseUrl}/chat/${id}/`;
        console.log("Dang ket noi WebSocket toi:", wsUrl);

        chatSocket = new WebSocket(wsUrl);

        chatSocket.onopen = function() {
            console.log("Ket noi WebSocket thanh cong");
        };

        chatSocket.onmessage = function(e) {
            const data = JSON.parse(e.data);
            if (data.type === 'typing' || data.type === 'stop_typing') return;
            appendWidgetMessage(data);
        };

        chatSocket.onclose = function() {
            console.warn('Mat ket noi WebSocket. Thu lai sau 3s...');
            setTimeout(() => {
                const widgetWindow = document.getElementById('chat-widget-window');
                if (widgetWindow && !widgetWindow.classList.contains('d-none') && consultationId) {
                    connectWebSocket(consultationId);
                }
            }, 3000);
        };
    }

    async function fetchChatHistory(id) {
        try {
            const res = await fetch(`${apiBaseUrl}/consultations/${id}/messages/`);
            if (!res.ok) return;

            const msgs = await res.json();
            const msgBox = document.getElementById('chat-widget-messages');

            if (Array.isArray(msgs) && msgs.length > 0 && msgBox) {
                msgBox.innerHTML = '';
                msgs.forEach((m) => {
                    appendWidgetMessage({
                        message: m.message,
                        is_staff_reply: m.is_staff_reply,
                        attachment_url: m.attachment,
                        attachment_type: m.attachment_type,
                        created_at: new Date(m.created_at).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                    });
                });
            }
        } catch (e) {
            console.error("Loi lay lich su chat:", e);
        }
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
            const fileUrl = data.attachment_url.startsWith('http')
                ? data.attachment_url
                : `http://${currentHost}:8000${data.attachment_url}`;

            if (data.attachment_type === 'image') {
                contentHtml += `<div class="${data.message ? 'mt-1' : ''}"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" style="max-width: 100%; border-radius: 8px;"></a></div>`;
            } else {
                contentHtml += `<div class="${data.message ? 'mt-1' : ''}"><a href="${fileUrl}" target="_blank" style="color: inherit; text-decoration: underline;"><i class="fas fa-file-alt"></i> Tep dinh kem</a></div>`;
            }
        }

        const alignClass = isMe ? 'widget-msg-right' : 'widget-msg-left';
        const html = `
            <div class="widget-msg ${alignClass} animate-fade-in" style="animation: fadeIn 0.3s ease-in-out;">
                ${contentHtml}
                <div class="text-end" style="font-size: 10px; opacity: 0.7; margin-top: 3px;">
                    ${data.created_at || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
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
                message: text,
                sender_name: customerName,
                is_staff: false
            }));

            inputEl.value = '';
            inputEl.focus();
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatWidget);
} else {
    initChatWidget();
}
