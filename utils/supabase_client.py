import os
from supabase import create_client, Client
from dotenv import load_dotenv
import streamlit as st

# Load variables from .env if running locally without Streamlit Secrets
load_dotenv()

# Ưu tiên st.secrets (Streamlit Cloud) > biến môi trường (.env local)
def _get_secret(key: str) -> str:
    """Lấy secret từ st.secrets (Cloud) hoặc os.environ (.env local)."""
    try:
        return st.secrets[key]
    except (FileNotFoundError, KeyError):
        val = os.getenv(key)
        if not val:
            st.error(f"⚠️ Thiếu cấu hình: {key}. Vui lòng thiết lập trong Streamlit Secrets hoặc file .env")
        return val

SUPABASE_URL = _get_secret("SUPABASE_URL")
SUPABASE_KEY = _get_secret("SUPABASE_KEY")

@st.cache_resource
def init_supabase() -> Client:
    """
    Khởi tạo và trả về một Supabase Client.
    Sử dụng @st.cache_resource để không tạo lại kết nối nhiều lần trên mỗi lần Streamlit rerun.
    """
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        return supabase
    except Exception as e:
        st.error(f"Lỗi khởi tạo Supabase: {e}")
        return None

# Khởi tạo client dùng chung
supabase = init_supabase()
