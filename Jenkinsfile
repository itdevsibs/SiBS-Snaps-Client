pipeline {
    agent any


    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }


        stage('Prepare Docker Project Env') {
            steps {
                sh 'cp /var/jenkins_home/env-files/sibs-snaps-client.env "$WORKSPACE/.env"'
            }
        }


        stage('Build and Deploy') {
            steps {
                sh '''
                    set -eu


                    PROJECT_NAME="sibssnapsclient"
                    CONTAINER_NAME="SiBS-Snaps-Client"


                    # Build first so a build failure does not stop production
                    docker compose -p "$PROJECT_NAME" build


                    # Remove the old container only if it belongs to
                    # the SiBS-Snaps client deployment
                    if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
                        EXISTING_PROJECT=$(docker inspect "$CONTAINER_NAME" \
                            --format '{{index .Config.Labels "com.docker.compose.project"}}')


                        EXISTING_SERVICE=$(docker inspect "$CONTAINER_NAME" \
                            --format '{{index .Config.Labels "com.docker.compose.service"}}')


                        case "$EXISTING_PROJECT" in
                            sibs-snaps-client|sibssnapsclient)
                                if [ "$EXISTING_SERVICE" = "web" ]; then
                                    echo "Replacing existing SiBS-Snaps-Client container..."
                                    docker rm -f "$CONTAINER_NAME"
                                else
                                    echo "Container service does not match. Aborting."
                                    exit 1
                                fi
                                ;;
                            *)
                                echo "Unexpected container owner: $EXISTING_PROJECT"
                                echo "Aborting to avoid removing an unrelated container."
                                exit 1
                                ;;
                        esac
                    fi


                    # Deploy using a consistent Compose project name
                    docker compose -p "$PROJECT_NAME" up -d --no-build --remove-orphans


                    docker ps --filter "name=SiBS-Snaps-Client"
                '''
            }
        }
    }


    post {
        always {
            sh 'rm -f "$WORKSPACE/.env"'
        }
    }
}
