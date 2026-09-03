CREATE ROLE app_user LOGIN PASSWORD 'postgres_app_password';
GRANT CONNECT ON DATABASE ecom TO app_user;
