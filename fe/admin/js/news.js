// admin/js/news.js
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-add-news')?.addEventListener('click', () => { 
        document.getElementById('news-form').reset(); 
        new bootstrap.Modal(document.getElementById('newsModal')).show(); 
    });
    document.getElementById('btn-submit-news')?.addEventListener('click', submitNews);
    loadNews();
});

async function loadNews() {
    const list = document.getElementById('news-list'); 
    list.innerHTML = 'Đang tải...';
    try {
        // ĐÃ SỬA: /products/news/
        const news = await fetchAPI('/products/news/');
        list.innerHTML = news.map(n => `
            <div class="col-md-4 mb-3">
                <div class="card h-100 shadow-sm border-0">
                    <img src="${n.image ? n.image : ''}" class="card-img-top" style="height:150px;object-fit:cover">
                    <div class="card-body">
                        <h6 class="fw-bold">${n.title}</h6>
                        <small class="text-muted d-block mb-2">${new Date(n.created_at).toLocaleDateString()}</small>
                        <button class="btn btn-sm btn-outline-danger" onclick="window.deleteNews(${n.id})">Xóa bài</button>
                    </div>
                </div>
            </div>`).join('');
    } catch(e) { 
        list.innerHTML = '<p class="text-danger">Lỗi tải dữ liệu</p>'; 
    }
}

async function submitNews() {
    const fd = new FormData(); 
    fd.append('title', document.getElementById('n-title').value); 
    fd.append('content', document.getElementById('n-content').value);
    
    if(document.getElementById('n-image').files[0]) {
        fd.append('image', document.getElementById('n-image').files[0]);
    }

    try {
        // ĐÃ SỬA: /products/news/
        await fetch(`${API_BASE_URL}/products/news/`, { 
            method: 'POST', 
            headers: {'Authorization': `Bearer ${getAccessToken()}`}, 
            body: fd 
        });
        
        bootstrap.Modal.getInstance(document.getElementById('newsModal')).hide(); 
        loadNews(); 
        Toast.fire({icon:'success', title:'Đăng bài thành công'});
    } catch (e) {
        Toast.fire({icon:'error', title:'Đăng bài thất bại'});
    }
}

window.deleteNews = async function(id) { 
    if(!confirm('Bạn có chắc muốn xóa bài này?')) return; 
    
    try {
        // ĐÃ SỬA: /products/news/${id}/
        await fetchAPI(`/products/news/${id}/`, 'DELETE'); 
        loadNews(); 
        Toast.fire({icon:'success', title:'Đã xóa bài viết'});
    } catch (e) {
        Toast.fire({icon:'error', title:'Lỗi khi xóa bài'});
    }
};