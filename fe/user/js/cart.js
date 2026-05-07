// user/js/cart.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Kiểm tra đăng nhập (Bảo vệ Route)
    if (!getAccessToken()) {
        Swal.fire({
            icon: 'warning',
            title: 'Truy cập bị từ chối',
            text: 'Vui lòng đăng nhập để xem giỏ hàng!',
            confirmButtonText: 'Đăng nhập ngay',
            confirmButtonColor: '#D71920',
            allowOutsideClick: false
        }).then(() => {
            window.location.href = '../login.html';
        });
        return;
    }

    // 2. Tải dữ liệu giỏ hàng
    loadCartData();
});

async function loadCartData() {
    const container = document.getElementById('cart-container');
    
    try {
        const cart = await fetchAPI('/cart/'); // Gọi API lấy giỏ hàng
        
        // Cập nhật Header Badge ngay lập tức
        const badge = document.getElementById('cart-count-badge');
        if (badge) badge.innerText = cart.total_items || 0;

        // Nếu giỏ hàng trống
        if (!cart.items || cart.items.length === 0) {
            renderEmptyCart(container);
            return;
        }

        renderCartUI(container, cart);

    } catch (e) {
        console.error("Lỗi tải giỏ hàng:", e);
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <h5 class="text-danger fw-bold">Không thể kết nối đến dữ liệu giỏ hàng!</h5>
                <button class="btn btn-outline-danger mt-3 rounded-pill" onclick="loadCartData()"><i class="fas fa-sync-alt me-2"></i>Thử lại</button>
            </div>
        `;
    }
}

// Giao diện khi Giỏ hàng trống
function renderEmptyCart(container) {
    container.innerHTML = `
        <div class="col-12 text-center py-5 bg-white rounded-4 shadow-sm border-0">
            <img src="https://cdn-icons-png.flaticon.com/512/11329/11329060.png" alt="Empty Cart" style="width: 150px; opacity: 0.5;" class="mb-4">
            <h4 class="fw-bold text-dark">Giỏ hàng của bạn đang trống</h4>
            <p class="text-muted mb-4">Có vẻ như bạn chưa chọn gói bảo hiểm nào. Hãy khám phá các giải pháp của chúng tôi nhé!</p>
            <a href="../products.html" class="btn btn-danger btn-lg rounded-pill px-5 fw-bold shadow-sm">Mua sắm ngay</a>
        </div>
    `;
}

// Giao diện Giỏ hàng có sản phẩm
function renderCartUI(container, cart) {
    let itemsHtml = cart.items.map(item => {
        // Fallback ảnh sản phẩm (Vì API cart trả về nested package -> product)
        let imgUrl = 'https://placehold.co/100x100/f8f9fa/d71920?text=TIS';
        // Tuỳ thuộc vào cấu trúc API của bạn, ví dụ: item.package.product.images[0]
        if (item.package && item.package.image) {
             imgUrl = item.package.image.startsWith('http') ? item.package.image : DOMAIN + item.package.image;
        }

        let pkgName = item.package ? item.package.name : 'Gói bảo hiểm';
        let prodName = item.product_name || 'Bảo hiểm TIS';
        let price = item.subtotal || (item.package ? item.package.price : 0);

        return `
            <div class="d-flex align-items-center bg-white p-3 rounded-4 shadow-sm border-0 mb-3 cart-item-row" id="cart-item-${item.id}">
                <img src="${imgUrl}" class="cart-item-img me-3">
                <div class="flex-grow-1">
                    <span class="badge bg-danger-subtle text-danger mb-1 px-2 py-1 rounded-1 small">${prodName}</span>
                    <h6 class="fw-bold mb-1">${pkgName}</h6>
                    <div class="text-muted small">Số lượng: ${item.quantity || 1}</div>
                </div>
                <div class="text-end ms-3">
                    <div class="text-danger fw-bold fs-5 mb-2">${formatMoney(price)}</div>
                    <button class="btn btn-light btn-sm btn-remove border text-muted" onclick="removeItem(${item.id})" title="Xóa khỏi giỏ">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    let totalPrice = cart.total_price || 0;

    container.innerHTML = `
        <div class="col-lg-8">
            ${itemsHtml}
        </div>

        <div class="col-lg-4">
            <div class="card border-0 shadow-sm rounded-4 position-sticky" style="top: 100px;">
                <div class="card-body p-4">
                    <h5 class="fw-bold mb-4 pb-3 border-bottom">Tóm tắt đơn hàng</h5>
                    
                    <div class="d-flex justify-content-between mb-3 text-muted">
                        <span>Tạm tính (${cart.total_items} sản phẩm)</span>
                        <span class="fw-bold text-dark">${formatMoney(totalPrice)}</span>
                    </div>
                    <div class="d-flex justify-content-between mb-3 text-muted">
                        <span>Thuế VAT (10%)</span>
                        <span class="fw-bold text-dark">${formatMoney(totalPrice * 0.1)}</span>
                    </div>
                    <div class="d-flex justify-content-between mb-4 text-muted">
                        <span>Khuyến mãi</span>
                        <span class="text-success fw-bold">- 0 ₫</span>
                    </div>
                    
                    <div class="border-top pt-3 mb-4">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="fw-bold fs-5 text-dark">Tổng cộng</span>
                            <span class="fw-bolder fs-4 text-danger">${formatMoney(totalPrice * 1.1)}</span>
                        </div>
                        <div class="text-end text-muted small mt-1">(Đã bao gồm VAT)</div>
                    </div>

                    <button class="btn btn-danger btn-lg w-100 rounded-pill fw-bold shadow-sm" onclick="processCheckout()">
                        TIẾN HÀNH THANH TOÁN
                    </button>
                    
                    <div class="text-center mt-3">
                        <a href="../products.html" class="text-decoration-none text-danger small fw-bold transition-hover">
                            <i class="fas fa-arrow-left me-1"></i> Mua thêm sản phẩm khác
                        </a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Hàm Xóa sản phẩm khỏi giỏ
async function removeItem(itemId) {
    Swal.fire({
        title: 'Bạn có chắc chắn?',
        text: "Sản phẩm này sẽ bị xóa khỏi giỏ hàng!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#D71920',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Vâng, xóa nó!',
        cancelButtonText: 'Hủy'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // Giả định API xóa của bạn là POST tới /cart/remove/ với id sản phẩm
                // Hoặc DELETE tới /cart/items/{id}/. Bạn điều chỉnh url cho khớp Backend nhé.
                await fetchAPI(`/cart/remove/`, 'POST', { item_id: itemId });
                
                Toast.fire({ icon: 'success', title: 'Đã xóa sản phẩm!' });
                loadCartData(); // Tải lại giỏ hàng
                
            } catch (error) {
                Toast.fire({ icon: 'error', title: 'Lỗi khi xóa sản phẩm.' });
            }
        }
    });
}

// Hàm Thanh toán (Checkout)
function processCheckout() {
    // Chuyển hướng sang trang checkout hoặc gọi API thanh toán
    Swal.fire({
        title: 'Đang xử lý...',
        text: 'Chuyển hướng đến cổng thanh toán an toàn.',
        icon: 'info',
        showConfirmButton: false,
        timer: 1500
    }).then(() => {
        // Ví dụ: window.location.href = 'checkout.html';
        alert("Chức năng thanh toán đang được tích hợp!");
    });
}