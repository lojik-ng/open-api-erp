#!/usr/bin/env python3
import os
import sys
import uuid
import hashlib
import secrets
import sqlite3

# ANSI Escape Sequences for beautiful CLI styling
COLOR_BLUE = "\033[94m"
COLOR_GREEN = "\033[92m"
COLOR_YELLOW = "\033[93m"
COLOR_RED = "\033[91m"
COLOR_BOLD = "\033[1m"
COLOR_RESET = "\033[0m"

# Categorized permission list
PERMISSION_CATEGORIES = {
    "CRM Module": [
        ("read:leads", "View CRM leads"),
        ("write:leads", "Create/update CRM leads"),
        ("convert:lead", "Convert leads to clients"),
        ("read:clients", "View client records"),
        ("write:clients", "Create/update client records"),
        ("read:documents", "View CRM document attachments"),
        ("write:documents", "Create/delete CRM document attachments"),
    ],
    "Catalog Module": [
        ("read:products", "View product catalog"),
        ("write:products", "Create/update products"),
    ],
    "Invoicing Module": [
        ("read:invoices", "View invoices"),
        ("write:invoices", "Create/update invoices"),
        ("read:payments", "View payment details"),
        ("write:payments", "Record client payments"),
        ("read:subscriptions", "View subscriptions"),
        ("write:subscriptions", "Manage subscription cycles"),
    ],
    "Accounting Module": [
        ("read:accounts", "View chart of accounts"),
        ("write:accounts", "Manage/create general ledger accounts"),
        ("read:journal_entries", "View journal entries"),
        ("write:journal_entries", "Post journal entries"),
        ("reverse:journal", "Reverse posted journal entries"),
        ("read:periods", "View accounting periods"),
        ("write:periods", "Open new accounting periods"),
        ("close:period", "Close accounting periods (lock journal)"),
    ],
    "Inventory Module": [
        ("read:inventory", "View inventory levels and logs"),
        ("write:inventory", "Update stock counts & adjust inventory"),
        ("read:suppliers", "View supplier records"),
        ("write:suppliers", "Create/update supplier records"),
        ("read:purchase_orders", "View purchase orders"),
        ("write:purchase_orders", "Create/update purchase orders"),
    ],
    "HR Module": [
        ("read:employees", "View employee records"),
        ("write:employees", "Add/update employee profile details"),
        ("read:attendance", "View attendance logs"),
        ("write:attendance", "Record employee attendance"),
        ("read:leaves", "View leave requests"),
        ("write:leaves", "Submit/process leave requests"),
        ("read:payroll", "View payroll runs"),
        ("process:payroll", "Calculate and close payroll cycles"),
    ],
    "Monitored Communications": [
        ("read:monitored_communications", "View monitored communication logs"),
        ("write:monitored_communications", "Create/update/delete monitored communication logs"),
    ],
    "System / Special": [
        ("read:webhooks", "View registered outgoing webhooks"),
        ("write:webhooks", "Register/delete outgoing webhooks"),
        ("read:deleted", "Access soft-deleted historical records"),
        ("*", "Wildcard - Superuser permission (access everything)"),
    ]
}

# Flatten permission categories to a single indexed list for easy CLI selection
FLAT_PERMISSIONS = []
for cat, perms in PERMISSION_CATEGORIES.items():
    for name, desc in perms:
        FLAT_PERMISSIONS.append((name, desc, cat))

def print_header(title):
    print(f"\n{COLOR_BOLD}{COLOR_BLUE}=== {title} ==={COLOR_RESET}\n")

def print_success(msg):
    print(f"{COLOR_GREEN}✔ {msg}{COLOR_RESET}")

def print_error(msg):
    print(f"{COLOR_RED}x Error: {msg}{COLOR_RESET}")

def print_warning(msg):
    print(f"{COLOR_YELLOW}⚠ Warning: {msg}{COLOR_RESET}")

def find_env_file():
    """Finds the .env file in the current working directory or the script's directory."""
    cwd_env = os.path.join(os.getcwd(), ".env")
    script_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    
    if os.path.exists(cwd_env):
        return cwd_env
    elif os.path.exists(script_env):
        return script_env
    return None

def load_db_path():
    """Reads DB_PATH from .env or returns the default path."""
    env_file = find_env_file()
    db_path = "./data/erp.db" # Default path
    
    if env_file:
        try:
            with open(env_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DB_PATH="):
                        val = line.split("=", 1)[1].strip()
                        # Strip quotes if present
                        if val.startswith(('"', "'")) and val.endswith(('"', "'")):
                            val = val[1:-1]
                        if val:
                            db_path = val
                            break
            # Resolve relative db_path to the folder containing the .env file
            if not os.path.isabs(db_path):
                env_dir = os.path.dirname(env_file)
                db_path = os.path.abspath(os.path.join(env_dir, db_path))
        except Exception as e:
            print_warning(f"Failed to read .env file: {e}. Using default database path.")
    
    return db_path

def get_input(prompt, default=None, validator=None):
    """Utility to prompt user for input with custom validator."""
    while True:
        display = prompt
        if default is not None:
            display += f" [{default}]: "
        else:
            display += ": "
            
        user_input = input(display).strip()
        
        if not user_input and default is not None:
            return default
            
        if not user_input:
            print_error("Input cannot be empty. Please try again.")
            continue
            
        if validator:
            valid, val = validator(user_input)
            if valid:
                return val
            else:
                print_error(val)  # val contains error message when invalid
                continue
        return user_input

def validate_integer(val_str):
    try:
        val = int(val_str)
        if val <= 0:
            return False, "Must be a positive integer."
        return True, val
    except ValueError:
        return False, "Must be a valid integer."

def validate_yes_no(val_str):
    normalized = val_str.lower()
    if normalized in ('y', 'yes', 't', 'true', '1'):
        return True, True
    elif normalized in ('n', 'no', 'f', 'false', '0'):
        return True, False
    return False, "Please answer 'y' or 'n'."

def select_permissions(preselected=None):
    """Renders the permissions categories and prompts for selection."""
    print_header("Configure Assistant Permissions")
    if preselected is None:
        preselected = []
    
    # Print permissions categorized
    idx = 1
    current_category = ""
    for name, desc, category in FLAT_PERMISSIONS:
        if category != current_category:
            current_category = category
            print(f"\n{COLOR_BOLD}{COLOR_BLUE}[{current_category}]{COLOR_RESET}")
        
        status_flag = f"{COLOR_GREEN}[Selected]{COLOR_RESET} " if name in preselected else ""
        print(f"  {COLOR_BOLD}{idx:2d}.{COLOR_RESET} {status_flag}{name:<26} - {desc}")
        idx += 1
        
    print("\n" + "=" * 50)
    print(f"{COLOR_BOLD}Options:{COLOR_RESET}")
    print("  - Enter numbers separated by commas (e.g. 1, 4, 8) to select specific permissions.")
    print("  - Type 'all' or '*' to grant all permissions.")
    print("  - Press Enter to use current/empty permissions selection.")
    print("=" * 50 + "\n")
    
    user_sel = input("Select permissions: ").strip()
    if not user_sel:
        return preselected
        
    if user_sel.lower() in ('all', '*'):
        return ["*"]
        
    selected_perms = []
    parts = [p.strip() for p in user_sel.split(",")]
    
    for part in parts:
        try:
            num = int(part)
            if 1 <= num <= len(FLAT_PERMISSIONS):
                selected_perms.append(FLAT_PERMISSIONS[num - 1][0])
            else:
                print_warning(f"Skipping index '{part}': Out of range.")
        except ValueError:
            # Check if user typed the permission string directly
            valid_names = [item[0] for item in FLAT_PERMISSIONS]
            if part in valid_names:
                selected_perms.append(part)
            else:
                print_warning(f"Skipping invalid option: '{part}'")
                
    # Deduplicate permissions
    return list(set(selected_perms))

def select_assistant(cursor):
    """Lists assistants numbered and lets the user choose one."""
    cursor.execute("SELECT id, name, api_key_prefix, rate_limit_per_minute, is_admin FROM assistants ORDER BY name ASC")
    rows = cursor.fetchall()
    if not rows:
        print_warning("No assistants registered in the database.")
        return None
        
    print("\nRegistered Assistants:")
    for idx, row in enumerate(rows, 1):
        role = "Admin" if row[4] == 1 else "Standard"
        print(f"  {COLOR_BOLD}{idx:2d}.{COLOR_RESET} {row[1]:<25} | Prefix: {row[2]} | Role: {role:<8} | Rate Limit: {row[3]} req/min")
        
    def validate_choice(s):
        try:
            n = int(s)
            if 1 <= n <= len(rows):
                return True, n
            return False, f"Number must be between 1 and {len(rows)}."
        except ValueError:
            return False, "Invalid selection."
            
    sel_idx = get_input("\nSelect assistant by number", validator=validate_choice)
    return rows[sel_idx - 1]

def list_assistants_action(cursor):
    print_header("Registered Assistants List")
    cursor.execute("SELECT id, name, api_key_prefix, rate_limit_per_minute, is_admin, status, created_at FROM assistants ORDER BY name ASC")
    rows = cursor.fetchall()
    if not rows:
        print("No assistants registered in the database.")
        return
        
    print(f"{COLOR_BOLD}{'Name':<25} | {'Prefix':<8} | {'Role':<8} | {'Rate Limit':<12} | {'Status':<10} | {'Permissions'}{COLOR_RESET}")
    print("-" * 100)
    for row in rows:
        assistant_id, name, prefix, rate_limit, is_admin, status, created_at = row
        role = "Admin" if is_admin == 1 else "Standard"
        
        # Fetch permissions
        cursor.execute("SELECT permission FROM assistant_permissions WHERE assistant_id = ?", (assistant_id,))
        perms = [p[0] for p in cursor.fetchall()]
        perms_str = ", ".join(perms) if perms else "[None]"
        if is_admin == 1:
            perms_str = "[Bypassed - Admin]"
            
        print(f"{name:<25} | {prefix:<8} | {role:<8} | {rate_limit:<12} | {status:<10} | {perms_str}")
    print()

def add_assistant_action(cursor, conn):
    print_header("Add New Assistant")
    name = get_input("Enter Assistant Name")
    rate_limit = get_input("Enter Rate Limit per Minute", default=60, validator=validate_integer)
    is_admin = get_input("Is this assistant an administrator? (y/n)", default="n", validator=validate_yes_no)
    
    permissions = []
    if is_admin:
        print(f"\n{COLOR_YELLOW}Info: Admin assistants bypass all RBAC checks; explicit permissions are not required.{COLOR_RESET}")
    else:
        permissions = select_permissions()
        
    print_header("Confirm Assistant Creation")
    print(f"Name:        {COLOR_BOLD}{name}{COLOR_RESET}")
    print(f"Rate Limit:  {COLOR_BOLD}{rate_limit} requests/min{COLOR_RESET}")
    print(f"Admin Role:  {COLOR_BOLD}{'Yes' if is_admin else 'No'}{COLOR_RESET}")
    if not is_admin:
        print(f"Permissions: {COLOR_BOLD}{', '.join(permissions) if permissions else '[None]'}{COLOR_RESET}")
        
    confirm = get_input("\nCreate this assistant? (y/n)", default="y", validator=validate_yes_no)
    if not confirm:
        print_warning("Operation cancelled.")
        return
        
    assistant_id = str(uuid.uuid4())
    raw_key = f"erp_{secrets.token_hex(32)}"
    api_key_hash = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    api_key_prefix = raw_key[:8]
    
    try:
        cursor.execute("BEGIN TRANSACTION;")
        
        cursor.execute("""
            INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, rate_limit_per_minute, is_admin, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        """, (assistant_id, name, api_key_hash, api_key_prefix, rate_limit, 1 if is_admin else 0))
        
        if permissions and not is_admin:
            for perm in permissions:
                perm_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO assistant_permissions (id, assistant_id, permission)
                    VALUES (?, ?, ?)
                """, (perm_id, assistant_id, perm))
                
        conn.commit()
        print_success("Assistant saved to database successfully.")
        
        print_header("ASSISTANT CREDENTIALS (COPY NOW)")
        print(f"Assistant ID:   {COLOR_BOLD}{assistant_id}{COLOR_RESET}")
        print(f"API Key Prefix: {COLOR_BOLD}{api_key_prefix}{COLOR_RESET}")
        print(f"API Key:        {COLOR_BOLD}{COLOR_GREEN}{raw_key}{COLOR_RESET}")
        print(f"\n{COLOR_BOLD}{COLOR_RED}⚠️  IMPORTANT: Store this API Key securely. It will not be shown again and cannot be retrieved!{COLOR_RESET}\n")
        
    except Exception as db_err:
        conn.rollback()
        print_error(f"Database transaction failed: {db_err}")

def edit_assistant_action(cursor, conn):
    print_header("Edit Assistant Details")
    target = select_assistant(cursor)
    if not target:
        return
        
    assistant_id, current_name, prefix, current_rate, current_is_admin = target
    
    print(f"\nEditing Assistant: {COLOR_BOLD}{current_name}{COLOR_RESET} (Prefix: {prefix})")
    
    new_name = get_input("Enter New Name", default=current_name)
    new_rate = get_input("Enter Rate Limit per Minute", default=current_rate, validator=validate_integer)
    new_is_admin = get_input("Is this assistant an administrator? (y/n)", default="y" if current_is_admin == 1 else "n", validator=validate_yes_no)
    
    print_header("Confirm Updates")
    print(f"Name:        {COLOR_BOLD}{current_name}{COLOR_RESET} -> {COLOR_BOLD}{new_name}{COLOR_RESET}")
    print(f"Rate Limit:  {COLOR_BOLD}{current_rate}{COLOR_RESET} -> {COLOR_BOLD}{new_rate}{COLOR_RESET} requests/min")
    print(f"Admin Role:  {COLOR_BOLD}{'Yes' if current_is_admin == 1 else 'No'}{COLOR_RESET} -> {COLOR_BOLD}{'Yes' if new_is_admin else 'No'}{COLOR_RESET}")
    
    confirm = get_input("\nApply these changes? (y/n)", default="y", validator=validate_yes_no)
    if not confirm:
        print_warning("Operation cancelled.")
        return
        
    try:
        cursor.execute("BEGIN TRANSACTION;")
        
        cursor.execute("""
            UPDATE assistants
            SET name = ?, rate_limit_per_minute = ?, is_admin = ?, updated_at = datetime('now')
            WHERE id = ?
        """, (new_name, new_rate, 1 if new_is_admin else 0, assistant_id))
        
        # If toggled to admin, automatically delete old specific permissions to keep it clean
        if new_is_admin:
            cursor.execute("DELETE FROM assistant_permissions WHERE assistant_id = ?", (assistant_id,))
            
        conn.commit()
        print_success("Assistant updated successfully.")
    except Exception as e:
        conn.rollback()
        print_error(f"Failed to update assistant: {e}")

def set_rbac_action(cursor, conn):
    print_header("Set RBAC Permissions")
    target = select_assistant(cursor)
    if not target:
        return
        
    assistant_id, name, prefix, rate, is_admin = target
    
    if is_admin == 1:
        print_warning(f"Assistant '{name}' is configured as an Administrator.")
        print("Administrators bypass all RBAC checks automatically and do not require explicit permissions.")
        confirm = get_input("Do you still want to assign custom permissions? (y/n)", default="n", validator=validate_yes_no)
        if not confirm:
            return
            
    # Fetch current permissions
    cursor.execute("SELECT permission FROM assistant_permissions WHERE assistant_id = ?", (assistant_id,))
    current_perms = [p[0] for p in cursor.fetchall()]
    
    print(f"\nCurrent Permissions for '{name}': {', '.join(current_perms) if current_perms else '[None]'}")
    
    new_perms = select_permissions(preselected=current_perms)
    
    print_header("Confirm Permission Changes")
    print(f"Assistant:   {COLOR_BOLD}{name}{COLOR_RESET}")
    print(f"Old Scopes:  {', '.join(current_perms) if current_perms else '[None]'}")
    print(f"New Scopes:  {COLOR_BOLD}{', '.join(new_perms) if new_perms else '[None]'}{COLOR_RESET}")
    
    confirm = get_input("\nUpdate permissions? (y/n)", default="y", validator=validate_yes_no)
    if not confirm:
        print_warning("Operation cancelled.")
        return
        
    try:
        cursor.execute("BEGIN TRANSACTION;")
        cursor.execute("DELETE FROM assistant_permissions WHERE assistant_id = ?", (assistant_id,))
        for perm in new_perms:
            cursor.execute("""
                INSERT INTO assistant_permissions (id, assistant_id, permission)
                VALUES (?, ?, ?)
            """, (str(uuid.uuid4()), assistant_id, perm))
        conn.commit()
        print_success(f"Permissions for '{name}' updated successfully.")
    except Exception as e:
        conn.rollback()
        print_error(f"Failed to update permissions: {e}")

def remove_assistant_action(cursor, conn):
    print_header("Remove Assistant")
    target = select_assistant(cursor)
    if not target:
        return
        
    assistant_id, name, prefix, rate, is_admin = target
    
    print_warning(f"This will permanently delete assistant '{name}' (Prefix: {prefix}) and all associated API keys & permissions.")
    confirm = get_input("Are you absolutely sure? (y/n)", default="n", validator=validate_yes_no)
    if not confirm:
        print_warning("Operation cancelled.")
        return
        
    try:
        cursor.execute("BEGIN TRANSACTION;")
        cursor.execute("DELETE FROM assistants WHERE id = ?", (assistant_id,))
        conn.commit()
        print_success(f"Assistant '{name}' removed from database successfully.")
    except Exception as e:
        conn.rollback()
        print_error(f"Failed to delete assistant: {e}")

def adjust_database_permissions(db_path):
    """Adjusts the ownership of the database files to the host user and the 'docker' group."""
    try:
        # If run under sudo, get the real host user's UID and GID
        uid = int(os.environ.get('SUDO_UID', os.getuid()))
        gid = int(os.environ.get('SUDO_GID', os.getgid()))
    except (TypeError, ValueError):
        uid = os.getuid()
        gid = os.getgid()

    # Attempt to resolve GID for the 'docker' group
    try:
        import grp
        gid_docker = grp.getgrnam('docker').gr_gid
    except (KeyError, ImportError):
        gid_docker = gid

    # List of files and directories to adjust
    paths = [
        os.path.dirname(db_path),
        db_path,
        f"{db_path}-wal",
        f"{db_path}-shm"
    ]

    for p in paths:
        if os.path.exists(p):
            try:
                os.chown(p, uid, gid_docker)
            except PermissionError:
                # Silently ignore if we don't have permissions (e.g. running as normal user on root files)
                pass
            except Exception:
                pass

def main():
    if os.getuid() != 0:
        print_error("This utility requires administrator privileges to run.")
        print(f"Please execute it using: {COLOR_BOLD}sudo ./manage_assistant.py{COLOR_RESET}\n")
        sys.exit(1)

    db_path = load_db_path()
    adjust_database_permissions(db_path)
    
    if not os.path.exists(db_path):
        print_error(f"Database file not found at: '{db_path}'")
        print("Please start the server first or run migrations so the tables are initialized.")
        sys.exit(1)
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Enforce foreign key constraints
        cursor.execute("PRAGMA foreign_keys = ON;")
        
        # Verify that assistants table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='assistants'")
        if not cursor.fetchone():
            print_error(f"The 'assistants' table does not exist in database '{db_path}'.")
            print("Please run database migrations before managing assistants.")
            conn.close()
            sys.exit(1)
            
    except Exception as e:
        print_error(f"Failed to connect to database: {e}")
        sys.exit(1)
        
    try:
        while True:
            print_header("Open API ERP - Assistant Management")
            print(f"Database: {COLOR_BOLD}{db_path}{COLOR_RESET}\n")
            print("  1. List Registered Assistants")
            print("  2. Add New Assistant & Generate Key")
            print("  3. Edit Assistant Details (Name / Role)")
            print("  4. Set RBAC Permissions")
            print("  5. Remove Assistant")
            print("  6. Exit Utility")
            
            def validate_menu_choice(s):
                if s in ('1', '2', '3', '4', '5', '6'):
                    return True, s
                return False, "Please select an option from 1 to 6."
                
            choice = get_input("\nSelect an option", validator=validate_menu_choice)
            
            if choice == '1':
                list_assistants_action(cursor)
            elif choice == '2':
                add_assistant_action(cursor, conn)
            elif choice == '3':
                edit_assistant_action(cursor, conn)
            elif choice == '4':
                set_rbac_action(cursor, conn)
            elif choice == '5':
                remove_assistant_action(cursor, conn)
            elif choice == '6':
                print(f"\n{COLOR_GREEN}Exiting management utility. Goodbye!{COLOR_RESET}\n")
                break
                
            input(f"\nPress {COLOR_BOLD}Enter{COLOR_RESET} to return to the main menu...")
            
    except KeyboardInterrupt:
        print(f"\n\n{COLOR_YELLOW}Operation interrupted by user. Exiting.{COLOR_RESET}\n")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
