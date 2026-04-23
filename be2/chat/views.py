from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from django.core.files.storage import default_storage

@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
# Nếu cần bảo mật, thêm: @permission_classes([IsAuthenticated])
def upload_chat_attachment(request):
    file = request.FILES.get('file')
    if not file:
        return Response({'error': 'Không tìm thấy file'}, status=400)

    # 1. Lưu file vào thư mục media/chat_attachments/
    file_name = default_storage.save(f"chat_attachments/{file.name}", file)
    
    # 2. Lấy URL tuyệt đối của file
    file_url = request.build_absolute_uri(default_storage.url(file_name))

    # 3. Phân loại là hình ảnh hay tệp thông thường
    attachment_type = 'image' if file.content_type.startswith('image/') else 'document'

    return Response({
        'attachment_url': file_url,
        'attachment_type': attachment_type
    })