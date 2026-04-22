/**
 * fontend/js/common.js
 * Chức năng: Cấu hình API, Quản lý JWT (Access/Refresh) và Xử lý thông báo.
 */

// --- 1. CẤU HÌNH HỆ THỐNG ---
const DOMAIN = "http://localhost:8000";
const API_BASE_URL = `${DOMAIN}/api`;

// --- 2. QUẢN LÝ TOKEN ---
const getAccessToken = () => localStorage.getItem('access_token');
const getRefreshToken = () => localStorage.getItem('refresh_token');

/**
 * Lưu trữ Token vào máy. 
 * Vì Backend bật ROTATE_REFRESH_TOKENS, ta phải cập nhật cả Refresh Token mới.
 */
const saveTokens = (access, refresh) => {
    if (access) localStorage.setItem('access_token', access);
    if (refresh) localStorage.setItem('refresh_token', refresh);
};

const clearTokens = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_info');
};

// --- 3. KHỞI TẠO THÔNG BÁO (SWEETALERT2 SAFE) ---
// Kiểm tra sự tồn tại của Swal để tránh lỗi "ReferenceError"
let Toast = {
    fire: (obj) => console.log(`${obj.icon}: ${obj.title}`) 
};

if (typeof Swal !== 'undefined') {
    Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
    });
} else {
    console.warn("SweetAlert2 chưa được tải. Vui lòng kiểm tra script trong HTML.");
}

// --- 4. HÀM FETCH API TRUNG TÂM (CÓ TỰ ĐỘNG REFRESH) ---
async function fetchAPI(endpoint, method = 'GET', body = null) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Hàm tạo cấu hình yêu cầu
    const getOptions = (token) => {
        const headers = {};
        if (token) {
            // Sử dụng Bearer cho JWT theo cấu hình SIMPLE_JWT
            headers['Authorization'] = `Bearer ${token}`;
        }

        const options = { method, headers };

        if (body) {
            if (body instanceof FormData) {
                // Để trình duyệt tự xử lý Content-Type cho FormData (multipart/form-data)
                options.body = body;
            } else {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
        }
        return options;
    };

    try {
        let response = await fetch(url, getOptions(getAccessToken()));

        // XỬ LÝ KHI TOKEN HẾT HẠN (401)
        if (response.status === 401 && getRefreshToken()) {
            console.warn("Access Token hết hạn, đang thực hiện xoay vòng mã thông báo...");
            
            const isRefreshed = await handleRefreshToken();
            if (isRefreshed) {
                // Thử lại yêu cầu cũ với Access Token mới vừa nhận
                response = await fetch(url, getOptions(getAccessToken()));
            } else {
                window.logout();
                return;
            }
        }

        // Xử lý lỗi phân quyền hoặc lỗi dữ liệu (403, 400...)
        if (!response.ok) {
            const errorData = await response.json();
            throw errorData; 
        }

        // DELETE thành công thường không trả về JSON (204 No Content)
        if (response.status === 204 || method === 'DELETE') return { success: true };
        
        return await response.json();

    } catch (error) {
        console.error(`Lỗi API (${endpoint}):`, error);
        throw error; 
    }
}

// --- 5. LOGIC XOAY VÒNG TOKEN (TOKEN ROTATION) ---
async function handleRefreshToken() {
    const refresh = getRefreshToken();
    if (!refresh) return false;

    try {
        const res = await fetch(`${API_BASE_URL}/token/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: refresh })
        });

        if (res.ok) {
            const data = await res.json();
            // PHẢI lưu cả refresh mới vì ROTATE_REFRESH_TOKENS = True
            saveTokens(data.access, data.refresh);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// --- 6. HÀM TIỆN ÍCH ---
// fontend/js/common.js
window.logout = function() {
    clearTokens();
    // Sử dụng đường dẫn gốc để không bị ảnh hưởng bởi thư mục hiện tại
    const rootPath = window.location.origin;
    window.location.replace(`${rootPath}/login.html`);
};

function formatMoney(amount) {
    if (!amount) return '0đ';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}