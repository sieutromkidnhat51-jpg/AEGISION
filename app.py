import streamlit as st
from components.calibration import show_calibration_popup, render_sidebar_settings
from components.dashboard import render_dashboard
from components.roadmap import render_roadmap_agent
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

st.title("👁️ IrisAdapt Pro - Hệ thống bảo vệ mắt")

# Render Sidebar
render_sidebar_settings()

# Luôn gọi hàm này để kiểm tra và hiển thị popup nếu user chưa cấu hình
show_calibration_popup()

# Nếu đã cấu hình thì mới hiện Dashboard chính
if st.session_state.get("calibrated", False):
    st.success(f"Đã tải cấu hình: {st.session_state['config']['eye_type']}")
    
    # Tạo các tab chức năng chính
    tab_dashboard, tab_roadmap = st.tabs(["📊 Dashboard Tracking", "🤖 AI Roadmap Agent"])
    
    with tab_dashboard:
        render_dashboard()
        
    with tab_roadmap:
        render_roadmap_agent()
else:
    st.warning("Vui lòng hoàn thành thiết lập cấu hình ở Popup để bắt đầu sử dụng hệ thống.")
