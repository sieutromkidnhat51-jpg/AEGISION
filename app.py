import streamlit as st
from components.auth import render_auth_ui
from components.calibration import show_calibration_popup, render_sidebar_settings
from components.dashboard import render_dashboard
from components.roadmap import render_roadmap_agent
from utils.supabase_client import supabase
import time

# Cấu hình trang Streamlit
st.set_page_config(
    page_title="IrisAdapt Pro",
    page_icon="👁️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# === CUSTOM CSS (UI/UX) ===
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }
    /* Bo góc cho khung WebRTC video */
    video {
        border-radius: 15px !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
    }
    /* Bo góc cho input và nút bấm */
    .stButton>button {
        border-radius: 8px !important;
        font-weight: 600 !important;
    }
    .stTextInput>div>div>input {
        border-radius: 8px !important;
    }
    /* Đổ bóng cho các khối container */
    [data-testid="stVerticalBlock"] > [style*="flex-direction: column;"] > [data-testid="stVerticalBlock"] {
        background-color: rgba(30, 35, 41, 0.5);
        padding: 20px;
        border-radius: 15px;
    }
</style>
""", unsafe_allow_html=True)

# === XỬ LÝ ĐĂNG NHẬP GOOGLE OAUTH (PKCE FLOW) ===
code = st.query_params.get("code")
if code and "user" not in st.session_state:
    try:
        # Lấy được code từ Google trả về, đổi lấy session
        res = supabase.auth.exchange_code_for_session({"auth_code": code})
        st.session_state["user"] = res.user
        
        # Xóa code trên thanh địa chỉ URL để sạch giao diện
        st.query_params.clear()
        
        # Reload trang
        st.rerun()
    except Exception as e:
        st.error(f"Lỗi xác thực OAuth: Vui lòng thử đăng nhập lại.")
        
st.title("👁️ IrisAdapt Pro - Hệ thống bảo vệ mắt")

if "user" not in st.session_state:
    render_auth_ui()
else:
    # Render Sidebar
    render_sidebar_settings()

    # Luôn gọi hàm này để kiểm tra và hiển thị popup nếu user chưa cấu hình
    show_calibration_popup()

    # Nếu đã cấu hình thì mới hiện Dashboard chính
    if st.session_state.get("calibrated", False):
        st.success(f"Đã tải cấu hình: {st.session_state['config']['eye_type']} | User ID: {st.session_state['user'].id}")
        
        # Tạo các tab chức năng chính
        tab_dashboard, tab_roadmap = st.tabs(["📊 Dashboard Tracking", "🤖 AI Roadmap Agent"])
        
        with tab_dashboard:
            render_dashboard()
            
        with tab_roadmap:
            render_roadmap_agent()
    else:
        st.warning("Vui lòng hoàn thành thiết lập cấu hình ở Popup để bắt đầu sử dụng hệ thống.")

    # Thêm nút Đăng xuất vào sidebar
    st.sidebar.markdown("---")
    if st.sidebar.button("Đăng xuất", type="primary"):
        del st.session_state["user"]
        st.rerun()
