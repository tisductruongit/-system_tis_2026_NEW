# Sử dụng Python 3.11 (hoặc 3.12) bản slim cho nhẹ
FROM python:3.11-slim

# Thiết lập biến môi trường
# Không tạo ra các file .pyc
ENV PYTHONDONTWRITEBYTECODE 1 
# Output log thẳng ra terminal, không bị buffer
ENV PYTHONUNBUFFERED 1

# Tạo thư mục làm việc trong container
WORKDIR /app

# Cài đặt các thư viện hệ thống cần thiết (nếu có dùng cryptography/cffi)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy file requirements.txt vào container
COPY requirements.txt /app/

# Cài đặt thư viện Python
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn dự án vào container
COPY . /app/

# Tạo thư mục media và static (nếu chưa có)
RUN mkdir -p /app/media /app/static

# Expose port 8000 ra ngoài
EXPOSE 8000

# Lệnh khởi chạy server bằng Daphne (do bạn dùng ASGI/Channels)
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "insurance_project.asgi:application"]