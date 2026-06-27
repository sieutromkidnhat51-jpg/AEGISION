import streamlit as st
from utils.supabase_client import supabase

def _get_redirect_url() -> str:
    """
    Tự động xác định redirect URL dựa trên môi trường:
    - Streamlit Cloud: lấy từ st.secrets["REDIRECT_URL"]
    - Local: dùng http://localhost:8501
    """
    try:
        return st.secrets["REDIRECT_URL"]
    except (FileNotFoundError, KeyError):
        return "http://localhost:8501"

def render_auth_ui():
    """
    Hiển thị giao diện Đăng nhập bằng Google
    """
    st.write("Vui lòng đăng nhập để lưu trữ dữ liệu sinh trắc học và lịch sử luyện mắt.")
    
    st.markdown("---")
    st.subheader("Đăng nhập")
    
    # Nút bấm đăng nhập
    if st.button("🌐 Tiếp tục với Google", type="primary", use_container_width=True):
        try:
            redirect_url = _get_redirect_url()
            
            # Gọi API Supabase để tạo link đăng nhập Google (PKCE Flow)
            res = supabase.auth.sign_in_with_oauth({
                "provider": "google",
                "options": {
                    "redirect_to": redirect_url,
                    "skip_browser_redirect": True
                }
            })
            
            # Dùng markdown để ép trình duyệt tự động chuyển hướng ngay lập tức
            st.markdown(f'<meta http-equiv="refresh" content="0; url={res.url}">', unsafe_allow_html=True)
            
        except Exception as e:
            st.error(f"Lỗi khởi tạo đăng nhập Google: {str(e)}")
            
    st.markdown("---")

