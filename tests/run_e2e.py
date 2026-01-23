import sys
import os
import subprocess
import time
import threading
from playwright.sync_api import sync_playwright

def start_server():
    """Start a simple HTTP server in the background."""
    # Run from project root
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    subprocess.run([sys.executable, "-m", "http.server", "8081"], cwd=root_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def run_tests():
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Give server a moment to start
    time.sleep(2)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print("Running Frontend Unit Tests...")
        try:
            page.goto("http://localhost:8081/tests/runner.html")
            
            # Wait for status to verify test completion
            # Timeout after 10s
            status_element = page.wait_for_selector("#status:not(.pending)", timeout=10000)
            
            status_class = status_element.get_attribute("class")
            status_text = status_element.inner_text()
            
            if "success" in status_class:
                print(f"✅ Frontend Tests Passed: {status_text}")
                success = True
            else:
                print(f"❌ Frontend Tests Failed: {status_text}")
                # Print errors
                errors = page.locator(".test-case.fail").all_inner_texts()
                for error in errors:
                    print(f"  - {error}")
                success = False
                
        except Exception as e:
            print(f"❌ Error running tests: {e}")
            success = False
        finally:
            browser.close()
            
    return success

if __name__ == "__main__":
    if run_tests():
        sys.exit(0)
    else:
        sys.exit(1)
