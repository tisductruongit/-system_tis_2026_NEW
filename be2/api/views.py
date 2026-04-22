# backend/api/views.py

import time
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import viewsets, permissions, status, filters, mixins
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

# Import Models
from .models import (
    Product, ProductImage, ProductPackage, Category,
    Order, OrderItem, News, User, EnterpriseEmployee, 
    ConsultationRequest, Cart, CartItem
)

# Import Serializers
from .serializers import (
    ProductSerializer, CategorySerializer, OrderSerializer, 
    EnterpriseEmployeeSerializer, RegisterSerializer, 
    CartItemSerializer, OrderItemSerializer,
    ProductPackageSerializer, ConsultationRequestSerializer, NewsSerializer,
    UserSerializer
)

# --- PHÂN QUYỀN TÙY CHỈNH (INTERNAL) ---

class IsTISAdminOrStaff(permissions.BasePermission):
    """
    Quyền truy cập dành cho cấp quản trị dựa trên trường 'role' trong Model User.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and \
               (request.user.is_staff or request.user.role in ['super_admin', 'admin', 'staff'])

# --- AUTH VIEWSETS ---

class RegisterView(viewsets.GenericViewSet, mixins.CreateModelMixin):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

class UserViewSet(viewsets.ModelViewSet):
    """Quản lý thông tin người dùng và lấy dữ liệu cá nhân (me)"""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer

    def get_serializer_class(self):
        if self.action == 'create':
            return RegisterSerializer
        return UserSerializer # Serializer đầy đủ thông tin

    @action(detail=False, methods=['get'])
    def me(self, request):
        # Đảm bảo dùng UserSerializer ở đây
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

# --- BUSINESS VIEWSETS ---

class CategoryViewSet(viewsets.ModelViewSet):
    """Quản lý danh mục bảo hiểm"""
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    
    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [permissions.AllowAny()]
        # Chấp nhận Admin/Super Admin/Staff thực hiện ghi dữ liệu
        return [IsTISAdminOrStaff()]

class ProductViewSet(viewsets.ModelViewSet):
    """Quản lý sản phẩm, giá phí và album ảnh"""
    queryset = Product.objects.all().order_by('-created_at')
    serializer_class = ProductSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'category__name', 'provider_name']
    


    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [permissions.AllowAny()]
        return [IsTISAdminOrStaff()]

    @action(detail=False, methods=['get'])
    def featured(self, request):
        """Lấy danh sách sản phẩm nổi bật"""
        products = self.queryset.filter(is_featured=True)
        serializer = self.get_serializer(products, many=True)
        return Response(serializer.data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Xử lý tạo Sản phẩm + Gói giá + Nhiều ảnh trong 1 lần gửi"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()

        # Xử lý Gói giá phí mặc định
        base_price = request.data.get('base_price')
        is_hidden = request.data.get('is_price_hidden')
        if base_price and not (is_hidden == 'True' or is_hidden is True):
            try:
                # ÉP KIỂU SỐ ĐỂ ĐẢM BẢO KHÔNG LƯU 0
                numeric_price = float(base_price) 
                ProductPackage.objects.create(
                    product=product,
                    duration_label='1 Năm',
                    duration_days=365,
                    price=numeric_price
                )
            except (ValueError, TypeError):
                print("Lỗi định dạng giá phí!")

        # Xử lý Upload nhiều ảnh
        images = request.FILES.getlist('uploaded_images')
        for img in images:
            ProductImage.objects.create(product=product, image=img)

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        """Cập nhật Sản phẩm và đồng bộ hóa Gói giá/Ảnh"""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()

        # Cập nhật hoặc Tạo mới gói giá
        base_price = request.data.get('base_price')
        if base_price:
            ProductPackage.objects.update_or_create(
                product=product,
                duration_label='1 Năm',
                defaults={'price': base_price, 'duration_days': 365}
            )

        # Thêm ảnh mới nếu có
        images = request.FILES.getlist('uploaded_images')
        for img in images:
            ProductImage.objects.create(product=product, image=img)

        return Response(serializer.data)

    @action(detail=True, methods=['delete'])
    def delete_image(self, request, pk=None):
        """Xóa lẻ một tấm ảnh trong album"""
        image_id = request.data.get('image_id')
        try:
            img = ProductImage.objects.get(id=image_id, product_id=pk)
            img.delete()
            return Response({"message": "Đã xóa ảnh thành công"}, status=status.HTTP_204_NO_CONTENT)
        except ProductImage.DoesNotExist:
            return Response({"error": "Ảnh không tồn tại"}, status=status.HTTP_404_NOT_FOUND)

class OrderViewSet(viewsets.ModelViewSet):
    """Quản lý đơn hàng"""
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Order.objects.none() # Trả về list rỗng cho Swagger
    
        user = self.request.user
        if user.role in ['admin', 'super_admin']:
            return Order.objects.all()
        return Order.objects.filter(user=user)

    @action(detail=False, methods=['post'])
    def buy_now(self, request):
        package_id = request.data.get('package_id')
        quantity = int(request.data.get('quantity', 1))
        
        try:
            package = ProductPackage.objects.get(id=package_id)
            total = package.price * quantity
            order_code = f"ORD-{int(time.time())}"
            
            order = Order.objects.create(
                user=request.user,
                total_amount=total,
                status='pending',
                code=order_code
            )
            OrderItem.objects.create(order=order, package=package, quantity=quantity)
            return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def checkout_cart(self, request):
        try:
            cart = Cart.objects.get(user=request.user)
            items = cart.items.all()
            
            if not items.exists():
                return Response({"error": "Giỏ hàng đang trống"}, status=status.HTTP_400_BAD_REQUEST)

            total_amount = sum(item.package.price * item.quantity for item in items)
            order_code = f"ORD-{int(time.time())}"
            
            with transaction.atomic():
                order = Order.objects.create(
                    user=request.user,
                    total_amount=total_amount,
                    status='pending',
                    code=order_code
                )
                
                # Chuyển CartItem thành OrderItem
                for item in items:
                    OrderItem.objects.create(
                        order=order, 
                        package=item.package, 
                        quantity=item.quantity
                    )
                
                # Xóa sạch giỏ hàng sau khi tạo đơn
                items.delete()

            return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
        except Cart.DoesNotExist:
            return Response({"error": "Không tìm thấy giỏ hàng"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)




class EmployeeViewSet(viewsets.ModelViewSet):
    serializer_class = EnterpriseEmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # 1. Bỏ qua nếu là fake view của Swagger
        if getattr(self, 'swagger_fake_view', False):
            return EnterpriseEmployee.objects.none()

        # 2. Đảm bảo user đã đăng nhập
        if not self.request.user.is_authenticated:
            return EnterpriseEmployee.objects.none()

        # Code cũ của bạn
        return EnterpriseEmployee.objects.filter(enterprise=self.request.user)

    def perform_create(self, serializer):
        serializer.save(enterprise=self.request.user)

# backend/api/views.py
from .models import ChatMessage
from .serializers import ChatMessageSerializer

class ConsultationRequestViewSet(viewsets.ModelViewSet):
    queryset = ConsultationRequest.objects.all().order_by('-created_at') # Sắp xếp mới nhất lên đầu
    serializer_class = ConsultationRequestSerializer
    
    # --- SỬA ĐOẠN NÀY ---
    def get_permissions(self):
        # Cho phép bất kỳ ai (kể cả khách) được gửi yêu cầu (POST)
        if self.action == 'create':
            return [permissions.AllowAny()]
        # Các hành động xem/xóa/sửa thì bắt buộc phải đăng nhập
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        # Nếu chưa đăng nhập (trường hợp hiếm khi lọt vào get_queryset trừ khi code lỗi) thì trả rỗng
        if not self.request.user.is_authenticated:
            return ConsultationRequest.objects.none()

        user = self.request.user
        # Admin/Staff thấy tất cả, User thường chỉ thấy của mình
        if user.role in ['admin', 'super_admin', 'staff']:
            return ConsultationRequest.objects.all().order_by('-created_at')
        return ConsultationRequest.objects.filter(user=user).order_by('-created_at')

    @action(detail=True, methods=['post'])
    def assign_processor(self, request, pk=None):
        """Staff nhận ticket này để xử lý"""
        consultation = self.get_object()
        
        # Nếu chưa ai nhận thì gán cho user hiện tại
        if not consultation.processor:
            consultation.processor = request.user
            consultation.status = 'processed' # Chuyển trạng thái
            consultation.save()
            return Response({"status": "assigned", "processor": request.user.username})
        
        # Nếu đã có người nhận rồi
        return Response({"status": "already_assigned", "processor": consultation.processor.username})


# THÊM CÁC ACTION NÀY VÀO:
    @action(detail=True, methods=['post'])
    def assign_processor(self, request, pk=None):
        consultation = self.get_object()
        if not consultation.processor:
            consultation.processor = request.user
            consultation.status = 'processed'
            consultation.save()
        return Response({"status": "assigned", "processor": request.user.username})

    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        consultation = self.get_object()

        # 1. LẤY DANH SÁCH TIN NHẮN
        if request.method == 'GET':
            messages = consultation.messages.all().order_by('created_at')
            serializer = ChatMessageSerializer(messages, many=True)
            return Response(serializer.data)

        # 2. GỬI TIN NHẮN MỚI
        if request.method == 'POST':
            message_text = request.data.get('message', '')
            attachment = request.FILES.get('attachment') # Nếu có gửi file

            if not message_text and not attachment:
                return Response({"error": "Vui lòng nhập nội dung"}, status=status.HTTP_400_BAD_REQUEST)

            # Tạo tin nhắn mới
            new_message = ChatMessage.objects.create(
                consultation=consultation,
                sender=request.user,
                message=message_text,
                attachment=attachment,
                is_staff_reply=False # Đánh dấu đây là tin nhắn của khách
            )
            
            return Response(ChatMessageSerializer(new_message).data, status=status.HTTP_201_CREATED)


class NewsViewSet(viewsets.ModelViewSet):
    queryset = News.objects.all()
    serializer_class = NewsSerializer

    def get_permissions(self):
        if self.action in ['create', 'update', 'destroy']:
            return [IsTISAdminOrStaff()]
        return [permissions.AllowAny()]

class CartViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        cart, _ = Cart.objects.get_or_create(user=request.user)
        items = cart.items.all()
        total_price = sum(item.package.price * item.quantity for item in items)
        return Response({
            "items": CartItemSerializer(items, many=True).data,
            "total_price": total_price,
            "total_items": items.count()
        })

    @action(detail=False, methods=['post'])
    def add(self, request):
        package_id = request.data.get('package_id')
        quantity = int(request.data.get('quantity', 1))
        cart, _ = Cart.objects.get_or_create(user=request.user)
        try:
            package = ProductPackage.objects.get(id=package_id)
            item, created = CartItem.objects.get_or_create(cart=cart, package=package)
            if not created:
                item.quantity += quantity
            item.save()
            return Response({"status": "Added to cart"})
        except ProductPackage.DoesNotExist:
             return Response({"error": "Product Package not found"}, status=404)

    @action(detail=False, methods=['post'])
    def update_item(self, request):
        item_id = request.data.get('item_id')
        quantity = int(request.data.get('quantity'))
        try:
            item = CartItem.objects.get(id=item_id, cart__user=request.user)
            if quantity <= 0:
                item.delete()
            else:
                item.quantity = quantity
                item.save()
            return Response({"status": "Cart updated"})
        except CartItem.DoesNotExist:
            return Response({"error": "Item not found"}, status=404)

    @action(detail=False, methods=['post'])
    def remove(self, request):
        item_id = request.data.get('item_id')
        try:
            item = CartItem.objects.get(id=item_id, cart__user=request.user)
            item.delete()
            return Response({"status": "Đã xóa sản phẩm khỏi giỏ hàng"})
        except CartItem.DoesNotExist:
            return Response({"error": "Không tìm thấy sản phẩm trong giỏ"}, status=404)


# --- UTILITY VIEWS ---

class DashboardSummaryView(APIView):
    """Báo cáo Dashboard tổng hợp cho quản trị viên"""
    permission_classes = [IsTISAdminOrStaff]

    def get(self, request):
        total_revenue = Order.objects.filter(status='active').aggregate(Sum('total_amount'))['total_amount__sum'] or 0
        total_orders = Order.objects.count()
        pending_orders = Order.objects.filter(status='pending').count()
        recent_orders = Order.objects.order_by('-created_at')[:5]

        return Response({
            "revenue": total_revenue,
            "total_orders": total_orders,
            "pending_orders": pending_orders,
            "recent_orders": OrderSerializer(recent_orders, many=True).data
        })

