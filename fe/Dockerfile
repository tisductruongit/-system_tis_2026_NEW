# Sử dụng Nginx bản alpine để phục vụ file tĩnh
FROM nginx:alpine

# Xóa các file mặc định của Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copy toàn bộ nội dung thư mục fontend vào thư mục gốc của Nginx
COPY . /usr/share/nginx/html

# Mở port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]